import net from 'net';
import EventEmitter from 'events';
import log from 'bookrc';
import Debug from 'debug';
import { clearTimeout } from 'timers';

const debug = Debug('localtunnel:server');

const Proxy = function(opt) {
    if (!(this instanceof Proxy)) {
        return new Proxy(opt);
    }

    const self = this;

    self.sockets = [];
    self.waiting = [];
    self.id = opt.id;

    // default max is 10
    self.max_tcp_sockets = opt.max_tcp_sockets || 20;

    // track initial user connection setup
    self.conn_timeout = undefined;

    self.debug = Debug(`localtunnel:server:${self.id}`);
};

Proxy.prototype.__proto__ = EventEmitter.prototype;

Proxy.prototype._openListener = function(server, cb){
    server.on('close', function(){
        self.debug("Closing listener on port %d", server.address().port)
    });
    server.on('connection', self._handle_socket.bind(self));

    server.on('error', function(err) {
        // where do these errors come from?
        // other side creates a connection and then is killed?
        if (err.code == 'ECONNRESET' || err.code == 'ETIMEDOUT') {
            return;
        }

        log.error(err);
    });

    server.listen(function() {
        const port = server.address().port;
        self.debug('tcp server listening on port: %d', port);

        cb(null, {
            // port for lt client tcp connections
            port: port,
            // maximum number of tcp connections allowed by lt client
            max_conn_count: self.max_tcp_sockets
        });
    });

    self._maybe_destroy();
}

Proxy.prototype.refreshListener = function (cb){
    const self = this
    const replacementServer = net.createServer();
    this._openListener(replacementServer, function(err, value){
        self.server = replacementServer
        self._maybe_destroy();
        cb(err, value)
    })
}

Proxy.prototype.start = function(cb) {
    const self = this;
    const server = self.server;

    if (self.started) {
        cb(new Error('already started'));
        return;
    }
    self.started = true;

    // new tcp server to service requests for this client
    self.server = net.createServer();
    self._openListener(self.server, cb)
};

Proxy.prototype._clearConnTimeout = function(){
    const self = this;
    if(self.conn_timeout){
        clearTimeout(self.conn_timeout)
        self.conn_timeout = undefined
    }
}

Proxy.prototype.stop = function(cb) {
    const self = this;
    const server = self.server;
    if(server) server.close();
};

Proxy.prototype._maybe_destroy = function() {
    const self = this;

    self._clearConnTimeout()
    self.conn_timeout = setTimeout(function() {
        // sometimes the server is already closed but the event has not fired?
        try {
            self._clearConnTimeout()
            self.server.close();
        }
        catch (err) {
            log.error("An error ocured while closing, Err: %s", err)
        }
    }, 60000);
}

Proxy.prototype._setup_new_socket = function(socket){
    const self = this;

    socket.once('close', function(had_error) {
        //self.debug('closed socket (error: %s)', had_error);

        // what if socket was servicing a request at this time?
        // then it will be put back in available after right?
        // we need a list of sockets servicing requests?

        // remove this socket
        const idx = self.sockets.indexOf(socket);
        if (idx >= 0) {
            self.sockets.splice(idx, 1);
        }

        // need to track total sockets, not just active available
        //self.debug('remaining client sockets: %s', self.sockets.length);

        // no more sockets for this ident
        if (self.sockets.length === 0) {
            self.debug('all sockets disconnected');
            self._maybe_destroy();
        }
    });

    // close will be emitted after this
    socket.on('error', function(err) {
        // we don't log here to avoid logging crap for misbehaving clients
        socket.destroy();
    });
    
    // Don't know whether keepalive does anything
    socket.setKeepAlive(true, 3*60*1000)
    
    // Calls to socket.end are made after clients lose power
    socket.setTimeout(4*60*1000)
    socket.on('timeout', function(){
        socket.end()
    })
}

Proxy.prototype._addSocket = function(socket){
    const self = this;
    
    if (self.sockets.length >= self.max_tcp_sockets) {
        const listeningAddress = self.server.address()
        for(var i in self.sockets){
            const s = self.sockets[i]
            if(s.localPort != listeningAddress.port){
                s.end()
                self.sockets.splice(i, 1)
            }
        }
        if (self.sockets.length >= self.max_tcp_sockets) {
            //Nothing was removed!
            return socket.end();
        }
    }
    self.sockets.push(socket);
}

// new socket connection from client for tunneling requests to client
Proxy.prototype._handle_socket = function(socket) {
    const self = this;

    self.debug('new connection from: %s:%s', socket.address().address, socket.address().port);

    // a single connection is enough to keep client id slot open
    self._clearConnTimeout()

    // Add socket
    self._addSocket(socket)

    // Configure socket
    self._setup_new_socket(socket)
    
    // Is anyone waiting on a socket?
    self._process_waiting();
};

Proxy.prototype._process_waiting = function() {
    const self = this;
    const wait_cb = self.waiting.shift();
    if (wait_cb) {
        self.debug('handling queued request');
        self.next_socket(wait_cb);
    }
};

Proxy.prototype._cleanup = function() {
    const self = this;
    self.debug('closed listening tcp socket for client(%s)', self.id);

    self._clearConnTimeout()

    // clear waiting by ending responses, (requests?)
    self.waiting.forEach(handler => handler(null));

    let oldSocks = self.sockets
    debug('ending old sockets of %s', self.id)
    for (let i=0; i<oldSocks.length; i++) {
      oldSocks[i].end()
    }

    self.emit('end');
};

Proxy.prototype.next_socket = function(handler) {
    const self = this;

    // socket is a tcp connection back to the user hosting the site
    const sock = self.sockets.shift();

    if (!sock) {
        self.debug('no more client, queue callback');
        self.waiting.push(handler);
        return;
    }

    handler(sock)
        .catch((err) => {
            log.error(err);
        })
        .finally(() => {
            if (!sock.destroyed) {
                self.debug('retuning socket');
                self.sockets.push(sock);
            }

            // no sockets left to process waiting requests
            if (self.sockets.length === 0) {
                return;
            }

            self._process_waiting();
        });
};

Proxy.prototype._done = function() {
    const self = this;
};

export default Proxy;

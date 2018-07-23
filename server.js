const {Server, Client} = require('quic'),
      http = require ('http'),
      Q = require('q'),
      debug = require('debug')('qtunnel:server'),
      ResponseTimeout = 60000

// ---------- Server ----------
const clients = {}

const server = new Server()
server
  .on('error', err => debug("server (1) error: %s", err))
  .on('session', (session) => {
    session
        .on('error', (err) => {
            debug("session (1) error: %s", err)
            session.destroy()
        })
        .on('stream', (stream) => {
            stream
            .on('error', (err) => debug("stream (1) error: %s", err))
            .on('data', (data) => {
                var hubId = data.toString()
                clients[hubId] = session
                session.on('error', (err) => {
                    if(clients[hubId] == session){
                        delete clients[hubId]
                    }
                })
                stream.end("OK")
                debug("Authenticated %s client", hubId)
            })
            .on('end', () => {
                debug(`server stream ${stream.id} ended`)
                stream.end()
            })
            .on('finish', () => {
                debug(`server stream ${stream.id} finished`)
            })
      })
  })

server.listen(2345, "0.0.0.0")
  .then(() => {
    debug(Object.assign({ class: 'server listen' }, server.address()))
  })
  .then(function(){
    const httpServer = http.createServer();

    function error_output(res, err){
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({error: err}))
    }
    
    httpServer.on('request', function(req, res) {
        debug("Received request for %s", req.url)
        
    
        req.on('error', (err) => {
            console.error('request', err);
        });
    
        res.on('error', (err) => {
            console.error('response', err);
        });

        var hubname
        if(process.env.HUBNAME){
            hubname = process.env.HUBNAME
        }else{
            hubname = req.headers['x-hub'];
            if (!hubname) {
                debug('No hubname!')
                error_output(res, "Invalid Hub")
                return false;
            }
        }

        const session = clients[hubname]
        if(!session){
            return error_output("no active client")
        }
    
        var stream = session.request ()
    
        const arr = [`${req.method} ${req.url} HTTP/${req.httpVersion}`];
        for (let i=0 ; i < (req.rawHeaders.length-1) ; i+=2) {
            const headerKey = req.rawHeaders[i];
            if(headerKey != "Connection"){
                arr.push(`${headerKey}: ${req.rawHeaders[i+1]}`);
            }
        }
        arr.push('Connection: close');
    
        arr.push('');
        arr.push('');
    
        var buffer = Buffer.from(arr.join("\r\n"), 'utf8');
    
        stream.on("error", err=>{
            debug(err)
            error_output("An error occurred communicating with the backend")
            stream.end()
        })
    
        const postData = req.method == 'POST' || req.method == 'PUT'
        var deferred = Q.defer()
        stream.write(buffer, function(err){
            if(err){
                deferred.reject("Stream write error: ", + err)
                return
            }
            debug("Headers written")
            deferred.resolve(true)
        })
        stream.pipe(req.connection)
        deferred.promise.then(function(){
            if (postData) {
                req.pipe(stream)
            }
        }).done()
    });
    
    
    httpServer.listen(8002, "0.0.0.0", 128, function() {
        debug("Started HTTP server on port 8002")
    })
  })
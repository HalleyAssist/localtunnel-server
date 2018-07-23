const {Server, Client} = require('quic'),
      http = require ('http'),
      Q = require('q'),
      debug = require('debug')('qtunnel:server'),
      ResponseTimeout = 60000

// ---------- Server ----------
var session
const server = new Server()
server
  .on('error', (err) => ilog.error(Object.assign(err, { class: 'server error' })))
  .on('session', (_session) => {
    // ilog.info(session)

    session = _session
  })

server.listen(2345)
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
        /*const hubname = req.headers['x-hub'];
        if (!hubname) {
            debug('No hubname!')
            error_output(res, "Invalid Hub")
            return false;
        }*/
    
        req.on('error', (err) => {
            console.error('request', err);
        });
    
        res.on('error', (err) => {
            console.error('response', err);
        });
    
        var stream = session.request ()
        console.log(stream)
    
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
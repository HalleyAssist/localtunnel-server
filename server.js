const zmq = require('zmq'),
      z85 = require('z85'),
      http = require ('http'),
      Q = require('q'),
      debug = require('debug')('ztunnel:server'),
      ResponseTimeout = 60000

// Setup a rep "server"
// Although ZMQ doesn't typically think of sockets as "server" or "client", the security mechanisms are different in that there should always be a "server" side that handles the authentication piece.
var zPublish = zmq.socket('pub');
var zReply = zmq.socket('sub');
zPublish.identity = "rep-socket";

// Tell the socket that we want it to be a CURVE "server"
//zPublish.curve_server = 1;
// Set the private key for the server so that it can decrypt messages (it does not need its public key)
//zPublish.curve_secretkey = serverPrivateKey;
// We'll also set a domain, but this is optional for the CURVE mechanism
//zPublish.zap_domain = "test";

// This is just typical rep bind stuff. 
zPublish.bindSync('tcp://0.0.0.0:12345');
zReply.bindSync('tcp://0.0.0.0:12346');

const server = http.createServer();

function error_output(res, err){
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({error: err}))
}

var messageId = 0

var wanted = {}
zReply.on('message', function(topic, message) {
    topic = topic.toString()
    var promise = wanted[topic]
    if(promise){
        promise.resolve(message)
    }else{
        debug("Unknown %s", topic)
    }
})

server.on('request', function(req, res) {
    /*const hubname = req.headers['x-hub'];
    if (!hubname) {
        debug('No hubname!')
        error_output(res, "Invalid Hub")
        return false;
    }*/
    const hubname = "test"

    req.on('error', (err) => {
        console.error('request', err);
    });

    res.on('error', (err) => {
        console.error('response', err);
    });

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

    /* request id */
    var bufferInt = new Buffer(2);
    bufferInt.writeUInt16LE(messageId)

    const topic = hubname + ":" + messageId
    zReply.subscribe(topic)

    const deferred = Q.defer()
    wanted[topic] = deferred
    const timeout = setTimeout(function(){
        deferred.reject("timeout")
    }, ResponseTimeout)
    deferred.promise.then(function(response){
        req.connection.end(response)
    }, function(err){
        error_output(res, err)
    }).fail(function(err){
        debug("Critical error: %s", err)
    }).finally(function(){
        delete wanted[topic]
        clearTimeout(timeout)
        zReply.unsubscribe(topic)
    })
    
    const postData = req.method == 'POST' || req.method == 'PUT'
    zPublish.send([hubname, bufferInt + buffer], postData)
    if (postData) {
        req.on('data', function (data) {
            zPublish.send([hubname, data], zmq.ZMQ_SNDMORE)
        })
        req.on('end', function () {
            zPublish.send([hubname, ""])
        })
    }

    messageId = (messageId + 1) % 65500
});


server.listen(8001, "0.0.0.0", 128, function() {
    debug("Started")
})
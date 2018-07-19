var zmq = require('zmq'),
    net = require('net'),
    fs = require('fs'),
    DynamicBuffer = require('DynamicBuffer'),
    debug = require('debug')('ztunnel:client')

var sock = zmq.socket('sub');
var sockReply = zmq.socket('pub');

sock.on('connect', function(fd, ep) {console.log('connect, endpoint:', ep);});
sock.on('connect_delay', function(fd, ep) {console.log('connect_delay, endpoint:', ep);});
sock.on('connect_retry', function(fd, ep) {console.log('connect_retry, endpoint:', ep);});
sock.on('listen', function(fd, ep) {console.log('listen, endpoint:', ep);});
sock.on('bind_error', function(fd, ep) {console.log('bind_error, endpoint:', ep);});
sock.on('accept', function(fd, ep) {console.log('accept, endpoint:', ep);});
sock.on('accept_error', function(fd, ep) {console.log('accept_error, endpoint:', ep);});
sock.on('close', function(fd, ep) {console.log('close, endpoint:', ep);});
sock.on('close_error', function(fd, ep) {console.log('close_error, endpoint:', ep);});
sock.on('disconnect', function(fd, ep) {console.log('disconnect, endpoint:', ep);});

sock.connect('tcp://mothership.dev.halleyassist.info:12345');
sockReply.connect('tcp://mothership.dev.halleyassist.info:12346');

sock.subscribe(fs.readFileSync('/data/hub-id', 'utf8'));

console.log('Subscriber connected to port 12345');

sock.on('message', function(topic, ...messages) {
    var client = new net.Socket();
    var firstMessage = messages[0]
    const messageId = firstMessage.readUInt16LE()
    client.on('data', function(chunk) {
        sockReply.send([topic.toString() + ':' + messageId, chunk], 2);
    });
    client.on('end', function() {
        debug("Sent response %d to remote", messageId)
        sockReply.send([topic.toString() + ':' + messageId, ""]);
        client.close()
    });
    client.connect(80, '127.0.0.1', function() {
        debug("Connected to backend")
        messages[0] = firstMessage.slice(2)
        var chain = Q()
        messages.forEach(function(chunk, index){
            if(index % 2 == 1) return
            chain = chain.then(function(){
                var deferred = Q.defer()
                client.write(chunk, function(){
                    deferred.resolve(chunk)
                })
                return deferred.promise
            })
        })
        chain.then(function(){
            client.end()
        }, function(err){
            debug(err)
        })
    });
});
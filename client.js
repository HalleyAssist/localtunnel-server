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

sock.on('message', function(topic, message) {
    var client = new net.Socket();
    const messageId = message.readUInt16LE()
    client.connect(80, '127.0.0.1', function() {
        debug("Connected to backend")
        debug("Request: %s", message.slice(2).toString())
        client.write(message.slice(2));
    });
    var data = new DynamicBuffer(4096);
    client.on('data', function(chunk) {
        data.concat(chunk);
    });
    client.on('close', function() {
        debug("Sending response of %d length to remote", data.length)
        sockReply.send([topic.toString() + ':' + messageId, data.getBuffer()]);
    });
});
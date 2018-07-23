var {Server, Client} = require('quic'),
    net = require('net'),
    fs = require('fs'),
    Q = require('q'),
    pump = require('pump'),
    debug = require('debug')('qtunnel:client')

const hubname = process.env.HUBNAME ? process.env.HUBNAME : fs.readFileSync('/data/hub-id', 'utf8')

function doAuthenticate(client){
    debug("Starting authentication process as %s", hubname)
    var deferred = Q.defer()
    var stream = client.request()
    stream.on('data', (data) => {
        const response = data.toString()
        if(response == "OK"){
            debug("Authenticated")
            deferred.resolve(client)
        }else{
            debug("Invalid authentication response: %s", response)
            deferred.reject("Error: %s", response)
        }
    })
    stream.end()

    setTimeout(()=>deferred.reject("timeout authenticating"), 3000)

    return deferred.promise
}
function waitingPing(client, pingTimeout = 4000){
    var deferred = Q.defer()

    /* Every 1s until we catch it */
    var timeouts = []
    for(var i = 1000; i < pingTimeout; i+= 1000){
        timeouts.push(setTimeout(function(){
            client.ping().catch(()=>{})
        }, i))
    }

    setTimeout(()=>deferred.reject("timeout waiting on pong"), pingTimeout)
    client.ping().then(function(){
        /* Fast Poll for network activity */
        const interval = setInterval(function(){
            if(!client.closing && client.lastNetworkActivityTime && Date.now() - client.lastNetworkActivityTime <= 20){
                debug("Ping response received")
                deferred.resolve(false)
            }
        }, 10)

        deferred.promise.catch(function(){}).then(function(){
            for(var i = 0; i<timeouts.length; i++){
                clearTimeout(timeouts[i])
            }
            clearInterval(interval)
        })
    }, deferred.reject)

    return deferred.promise
}
function doConnectionHandler(client){
    client
        .on('error', (err) => debug(Object.assign(err, { class: 'client session error' })))
        .on('stream', function(stream) {
            debug("New stream")
            var client = new net.Socket();
            client.connect(80, '127.0.0.1', function() {
                debug("Connected to backend")
                stream.pipe(client)
                pump(client, stream)
                client.on('end', function() {
                    debug("Sent response to remote")
                    //client.end()
                    //stream.end()
                });
            })
    });
    
    if(pingHandle) clearTimeout(pingHandle)
    pingHandle = setTimeout(function(){
        doPing(client)
    }, 3000)

    debug("Ready for operation")
}
function doConnection(port = 2345){
    var newConnection = new Client()
    const addr = process.env.MOTHERSHIP_API || "localhost"
    return newConnection.connect(port, addr)
        .then(function(){
            if(newConnection.destroyed){
                return Q.reject("Destroyed")
            }
            newConnection.timeout = 6000
            return waitingPing(newConnection)
        }).then(function(){
            debug('Client connected to port %d', port);
            return newConnection /* for doAuthenticate */
        }).then(doAuthenticate)
        .then(function(){
            doConnectionHandler(newConnection)
            return newConnection
        })
}
var pingHandle
function doPing(client){
    var p
    if(!client || client.destroyed){
        if(!client) debug("Re-connecting as not connected")
        else debug("Re-connecting as client was destroyed")

        client = null
        p = doConnection()
    }else{
        p = waitingPing(client)
            .catch(function(err){
                debug("Re-connecting due to %s", err)
                client = null
                return doConnection()
            })
    }
    return p
        .then(function(_newC){
            if(!client){
                client = _newC
            }
            if(!client) {
                debug("Successfully (re)connected")
            }
            pingHandle = setTimeout(()=>doPing(client), 5000)    
        },
        function(err){
            if(typeof err === "undefined") err = "timeout"
            debug("Failed to (re)connect: %s", err)
            pingHandle = setTimeout(doPing, 8000)  /* doConnection */
        })
}

async function connect(){
    debug("Performing initial connection")
    var connected = false
    while(!connected){
        await doConnection().then(function(){
            connected = true
        }, function(err){
            if(typeof err === "undefined") err = "timeout"
            debug("QUIC connection failed, err: %s", err)
            return Q.timeout(2000).fail(()=>{})
        })
    }
}
connect()
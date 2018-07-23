var {Server, Client} = require('quic'),
    net = require('net'),
    fs = require('fs'),
    Q = require('q'),
    DynamicBuffer = require('DynamicBuffer'),
    debug = require('debug')('qtunnel:client')

const hubname = process.env.HUBNAME ? process.env.HUBNAME : fs.readFileSync('/data/hub-id', 'utf8')
var cli = new Client()
function doAuthenticate(){
    var deferred = Q.defer()
    var stream = cli.request()
    stream.on('data', (data) => {
        const response = data.toString()
        if(response == "OK"){
            deferred.resolve(true)
        }else{
            deferred.reject("Error: %s", response)
        }
    })
    stream.write(hubname)

    setTimeout(()=>deferred.reject("timeout authenticating"), 2000)

    return deferred.promise
}
function waitingPing(pingTimeout = 2000){
    var deferred = Q.defer()

    setTimeout(()=>deferred.reject("timeout waiting on pong"), pingTimeout)
    cli.ping().then(function(){
        /* Fast Poll for network activity */
        const interval = setInterval(function(){
            if(Date.now() - cli.lastActivityTime <= 15){
                debug("Ping response received")
                deferred.resolve(true)
            }
        }, 10)

        deferred.promise.catch(function(){}).then(function(){
            clearInterval(interval)
        })
    }, deferred.reject)

    return deferred.promise
}
function doConnection(port = 2345){
    if(cli.destroyed){
        cli = new Client()
    }
    return cli.connect(port)
        .then(function(){
            if(cli.destroyed){
                cli = new Client()
                return Q.reject("Destroyed")
            }
            cli.timeout = 6000
            return waitingPing()
        }).then(function(){
            debug('Client connected to port %d', port);
        }).then(doAuthenticate)
}
function doPing(){
    var p
    if(cli.destroyed){
        cli = new Client()
        p = doConnection()
    }else{
        p = waitingPing()
            .catch(function(){
                if(cli.destroyed){
                    cli = new Client()
                }
                return doConnection()
            })
    }
    return p
        .then(function(){
            setTimeout(doPing, 5000)    
        },
        function(err){
            if(typeof err === "undefined") err = "timeout"
            debug("Failed to (re)connect: %s", err)
            setTimeout(doPing, 1000)
        })
}

async function main(){
    var connected = false
    while(!connected){
        await doConnection().then(function(){
            connected = true
        }, function(err){
            if(typeof err === "undefined") err = "timeout"
            cli = new Client()
            debug("QUIC connection failed, err: %s", err)
            return Q.timeout(2000).fail(()=>{})
        })
    }
    setTimeout(function(){
        doPing()
    }, 3000)

    cli
        .on('error', (err) => debug(Object.assign(err, { class: 'client session error' })))
        .on('stream', function(stream) {
            debug("New stream")
            var client = new net.Socket();
            client.connect(3000, '192.168.1.252', function() {
                debug("Connected to backend")
                stream.pipe(client).pipe(stream)
                client.on('end', function() {
                    debug("Sent response to remote")
                    //client.end()
                    //stream.end()
                });
            })
    });
}
main()
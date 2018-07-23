var {Server, Client} = require('quic'),
    net = require('net'),
    fs = require('fs'),
    Q = require('q'),
    DynamicBuffer = require('DynamicBuffer'),
    debug = require('debug')('qtunnel:client')

var cli = new Client()
function doConnection(){
    return cli.connect(2345)
        .then(function(){
            if(cli.destroyed){
                throw new Error("Destroyed")
            }
            return cli.ping()
        }).then(function(){
            debug('Client connected to port 2345');
        })
}
function doPing(){
    var p
    if(cli.destroyed){
        cli = new Client()
        p = doConnection()
    }else{
        p = cli.ping()
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
            debug("Failed to (re)connect: %s", err)
            setTimeout(doPing, 1000)
        })
}

async function main(){
    var connected = false
    while(!connected){
        await doConnection().then(function(){
            connected = true
        }, function(ex){
            debug("QUIC connection failed")
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
                stream.pipe(client)
                client.pipe(stream)
                client.on('end', function() {
                    debug("Sent response to remote")
                    //client.end()
                    //stream.end()
                });
            })
    });
}
main()
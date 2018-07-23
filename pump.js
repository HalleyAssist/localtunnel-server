var once = require('once'),
    eos = require('end-of-stream'),
    debug = require('debug')('qtunnel:pump')

var noop = function () {}

var isFn = function (fn) {
  return typeof fn === 'function'
}

var isRequest = function (stream) {
  return stream.setHeader && isFn(stream.abort)
}

var destroyer = function (stream, reading, writing, callback) {
  callback = once(callback)

  var closed = false
  stream.on('close', function () {
    debug("closed = true")
    closed = true
  })

  eos(stream, {readable: reading, writable: writing}, function (err) {
    if (err) return callback(err)
    closed = true
    debug("closed = true via   eos")
    callback()
  })

  var destroyed = false
  return function (err) {
    if (destroyed) return
    destroyed = true

    if (isRequest(stream)) return stream.abort() // request.destroy just do .end - .abort is what we want

    if (isFn(stream.end)) {
      if(closed){
        debug("calling destroy")
        return stream.destroy()
      }else{
        debug("calling end")
        return stream.end(function(){
          debug("calling destroy")
          return stream.destroy()
        })
      }
    }

    callback(err || new Error('stream was destroyed'))
  }
}

var call = function (fn, ...args) {
  fn(...args)
}

var pipe = function (from, to) {
  return from.pipe(to)
}

var pump = function () {
  var streams = Array.prototype.slice.call(arguments)
  var callback = isFn(streams[streams.length - 1] || noop) && streams.pop() || noop

  if (Array.isArray(streams[0])) streams = streams[0]
  if (streams.length < 2) throw new Error('pump requires two streams per minimum')

  var error
  var destroys = streams.map(function (stream, i) {
    var reading = i < streams.length - 1
    var writing = i > 0
    return destroyer(stream, reading, writing, function (err) {
      if (!error) error = err
      if (err) destroys.forEach(call, err)
      if (reading) return
      if(!err) destroys.forEach(call)
      callback(error)
    })
  })

  return streams.reduce(pipe)
}

module.exports = pump
'use strict';

// server-side socket behaviour
var ios = null; // io is already taken in express
var util = require('Litecore').util;
var logger = require('../../lib/logger').logger;

module.exports.init = function(io_ext) {
  ios = io_ext;
  if (ios) {
    // when a new socket connects
    ios.sockets.on('connection', function(socket) {
      logger.verbose('New connection from ' + socket.id);

      // Enhanced error handling
      socket.on('error', function(error) {
        logger.error('Socket error:', error);
        socket.emit('connectionError', {
          message: 'Error connecting to peer network',
          details: error.message
        });
      });

      // when it subscribes, make it join the according room
      socket.on('subscribe', function(topic) {
        logger.debug('subscribe to ' + topic);
        socket.join(topic);

	      // Send initial sync status
        if (topic === 'sync') {
          socket.emit('syncStatus', {
            status: 'connected',
            timestamp: new Date().getTime()
          });
        }

        socket.emit('subscribed');
      });

      // disconnect handler
      socket.on('disconnect', function() {
        logger.verbose('disconnected ' + socket.id);
      });

    });
  }
  return ios;
};

var simpleTx = function(tx) {
  return {
    txid: tx
  };
};


var fullTx = function(tx) {
  return {
    txid: tx.txid,
    size: tx.size,
    valueOut: Number(tx.valueOut).toFixed(8), // Convert to number and format
    valueIn: Number(tx.valueIn).toFixed(8), // Convert to number and format
    fees: Number(tx.fees).toFixed(8), // Convert to number and format
    vout: tx.vout.map(function(o) {
      return {
        addresses: o.scriptPubKey.addresses,
        value: Number(o.value).toFixed(8), // Ensure value is a number and format it
        n: o.n
      };
    }),
    vin: tx.vin.map(function(v) {
      return {
        txid: v.txid,
        vout: v.vout,
        scriptSig: v.scriptSig
      };
    })
  };
};




module.exports.broadcastTx = function(tx) {
  if (ios) {
    var t = (typeof tx === 'string') ? simpleTx(tx) : fullTx(tx);
    ios.sockets.in('inv').emit('tx', t);
  }
};

module.exports.broadcastBlock = function(block) {
  if (ios)
    ios.sockets.in('inv').emit('block', block);
};

module.exports.broadcastAddressTx = function(txid, address) {
  if (ios) {
    ios.sockets.in(address).emit(address, txid);
  }
};

module.exports.broadcastSyncInfo = function(historicSync) {
  if (ios)
    ios.sockets.in('sync').emit('status', historicSync);
};

'use strict';
var imports     = require('soop').imports();
var fs          = require('fs');
var bitcore     = require('Litecore');
var bitcoreUtil = bitcore.util;
var Sync        = require('./Sync');
var Rpc = imports.rpc || require('./Rpc');
var Peer        = bitcore.Peer;
var PeerManager = bitcore.PeerManager;
var config      = require('../config/config');
var networks    = bitcore.networks;
var sockets     = require('../app/controllers/socket.js');
var PoolMatch   = imports.poolMatch || require('soop').load('./PoolMatch', config);

var peerdb_fn   = 'peerdb.json';
var logger = require('./logger').logger;

function PeerSync(opts) {
  opts = opts|| {};
  this.shouldBroadcast = opts.shouldBroadcast;
  this.connected = false;
  this.peerdb = undefined;
  this.allowReorgs = false;
  var pmConfig = {
    network: config.network
  };
  this.peerman = new PeerManager(pmConfig);
  this.load_peers();
  this.sync = new Sync(opts);
  this.poolMatch = new PoolMatch();
  this.verbose = opts.verbose || false;
}

PeerSync.prototype.log = function() {
  if (this.verbose) console.log(arguments);
};

PeerSync.prototype.load_peers = function() {
  this.peerdb = [{
    ipv4: config.bitcoind.p2pHost,
    port: config.bitcoind.p2pPort
  }];

  fs.writeFileSync(peerdb_fn, JSON.stringify(this.peerdb));
};

PeerSync.prototype.info = function() {
  return {
    connected: this.connected,
    host: this.peerdb[0].ipv4,
    port: this.peerdb[0].port
  };
};

PeerSync.prototype.handleInv = function(info) {
  var invs = info.message.invs;
  info.conn.sendGetData(invs);
};

PeerSync.prototype._broadcastAddr = function(txid, addrs) {
  if (addrs) {
    for(var ii in addrs){
      sockets.broadcastAddressTx(txid, ii);
    }
  }
};


PeerSync.prototype.prepareWebSocketMessage = function(tx) {
    return {
        txid: tx.txid,
        size: tx.size,
        valueOut: tx.valueOut,
        valueIn: tx.valueIn,
        fees: tx.fees,
        vout: tx.vout.map(function(vout) {
            return {
                value: vout.value,
                n: vout.n,
                scriptPubKey: vout.scriptPubKey
            };
        }),
        vin: tx.vin.map(function(vin) {
            return {
                txid: vin.txid,
                vout: vin.vout,
                scriptSig: vin.scriptSig
            };
        })
    };
  };
  


PeerSync.prototype.handleTx = function(info) {

  var self = this;
  logger.info('PeerSync received tx:', {
    hasMessage: !!info.message,
    hasTx: !!(info.message && info.message.tx),
    txInspect: info.message.tx ? {
      hasIns: !!info.message.tx.ins,
      insLength: info.message.tx.ins ? info.message.tx.ins.length : 0,
      hasOuts: !!info.message.tx.outs,
      outsLength: info.message.tx.outs ? info.message.tx.outs.length : 0,
      sample: info.message.tx.outs ? info.message.tx.outs[0] : null
    } : null
  });
  var tx = this.sync.txDb.getStandardizedTx(info.message.tx);
  self.log('[p2p_sync] Handle tx: ' + tx.txid);
  tx.time = tx.time || Math.round(new Date().getTime() / 1000);

  this.sync.storeTx(tx, function(err, relatedAddrs) {
    if (err) {
      self.log('[p2p_sync] Error in handle TX: ' + JSON.stringify(err));
    }
    // Fetch the complete transaction details, including the fee.
    self.sync.txDb.fromIdWithInfo(tx.txid, function(err, detailedTx) {
      if (err) {
        self.log('[p2p_sync] Error in handle TX: ' + JSON.stringify(err));
        return;
      }
      var tx = detailedTx.info;
      tx.time = tx.time || Math.round(new Date().getTime() / 1000);
      if (self.shouldBroadcast) {
        var wsData = self.prepareWebSocketMessage(detailedTx.info);
        sockets.broadcastTx(wsData);
        self._broadcastAddr(tx.txid, relatedAddrs);
      }
    });
  });

};



PeerSync.prototype.getStandardizedBlock = function(b) {
  var self = this;

  var block = {
    hash: bitcoreUtil.formatHashFull(b.getHash()),
    previousblockhash: bitcoreUtil.formatHashFull(b.prev_hash),
    time: b.timestamp,
    height: b.height,
    cool: "iscool",
  };
  var isCoinBase = 1;
  block.tx = b.txs.map(function(tx) {
    var ret = self.sync.txDb.getStandardizedTx(tx, b.timestamp, isCoinBase);
    isCoinBase = 0;
    return ret;
  });
  block.height = b.height;
  block.size = b.size;
  return block;
};

// In PeerSync.js, modify the handleBlock function

PeerSync.prototype.handleBlock = function(info) {
  var self = this;
  var block = info.message.block;
  var payload_size = info.message.size;
  var blockHash = bitcoreUtil.formatHashFull(block.calcHash());
  self.log('[p2p_sync] Handle block: %s (allowReorgs: %s)', blockHash, self.allowReorgs);

  var tx_hashes = block.txs.map(function(tx) {
    return bitcoreUtil.formatHashFull(tx.hash);
  });

  // Convert block from p2p format to RPC format
  var rpcBlock = {
    'hash': blockHash,
    'tx': tx_hashes,
    'previousblockhash': bitcoreUtil.formatHashFull(block.prev_hash),
    'time': block.timestamp
  };

  // Store the block directly without trying to query for coinbase info first
  self.sync.storeTipBlock(rpcBlock, self.allowReorgs, function(err, height) {
    if (err && err.message.match(/NEED_SYNC/) && self.historicSync) {
      self.log('[p2p_sync] Orphan block received. Triggering sync');
      self.historicSync.start({forceRPC:1}, function() {
        self.log('[p2p_sync] Done resync.');
      });
    } else if (err) {
      self.log('[p2p_sync] Error in handle Block: ', err);
    } else {
      self.sync.bDb.fromHashWithInfo(blockHash, function(err, detailedBlock) {
        if (err) {
          self.log('[p2p_sync] Error fetching detailed block info: ' + JSON.stringify(err));
          return;
        }

        // Get pool info after successful block storage
        var poolInfo = { url: "n/a", poolName: "Unknown" };
        if (tx_hashes.length > 0) {
          var coinbaseTx = tx_hashes[0];
          Rpc.getTxInfo(coinbaseTx, function(err, txInfo) {
            if (!err && txInfo && txInfo.vout && txInfo.vout[0] &&
                txInfo.vout[0].scriptPubKey && txInfo.vout[0].scriptPubKey.address) {
              var coinbase_address = txInfo.vout[0].scriptPubKey.address;
              poolInfo = self.poolMatch.match(coinbase_address);
            }

            var blockDetails = {
              hash: detailedBlock.info.hash,
              height: detailedBlock.info.height,
              time: detailedBlock.info.time,
              txlength: tx_hashes.length,
              size: payload_size,
              poolInfo: poolInfo
            };

            if (self.shouldBroadcast) {
              sockets.broadcastBlock(blockDetails);
            }
          });
        } else {
          var blockDetails = {
            hash: detailedBlock.info.hash,
            height: detailedBlock.info.height,
            time: detailedBlock.info.time,
            txlength: tx_hashes.length,
            size: payload_size,
            poolInfo: poolInfo
          };

          if (self.shouldBroadcast) {
            sockets.broadcastBlock(blockDetails);
          }
        }
      });
    }
  });
};

PeerSync.prototype.handleBlock2 = function(info) {
  var self = this;
  var block = info.message.block;
  var payload_size = info.message.size;
  var blockHash = bitcoreUtil.formatHashFull(block.calcHash());
  self.log('[p2p_sync] Handle block: %s (allowReorgs: %s)', blockHash, self.allowReorgs);

  var tx_hashes = block.txs.map(function(tx) {
    return bitcoreUtil.formatHashFull(tx.hash);
  });
  var coinbaseTx = tx_hashes[0];

  Rpc.getTxInfo(coinbaseTx, function(err, txInfo) {
    if (err) {
      self.log('Error retrieving transaction info:', err);
      return;  // Make sure to exit if there's an error
    }
    if (txInfo && txInfo.vout && txInfo.vout[0] && txInfo.vout[0].scriptPubKey) {
      var scriptPubKey = txInfo.vout[0].scriptPubKey;
      console.log('Full scriptPubKey:', scriptPubKey);
      var poolInfo = { url: "n/a", poolName: "Unknown" }
      var coinbase_address = scriptPubKey.address;
      if (coinbase_address) {
        console.log('Found coinbase address:', coinbase_address);
        poolInfo = self.poolMatch.match(coinbase_address);
        self.log("Matching completed:", poolInfo);
      }

      self.sync.storeTipBlock({
        'hash': blockHash,
        'tx': tx_hashes,
        'previousblockhash': bitcoreUtil.formatHashFull(block.prev_hash),
      }, self.allowReorgs, function(err, height) {
        if (err && err.message.match(/NEED_SYNC/) && self.historicSync) {
          self.log('[p2p_sync] Orphan block received. Triggering sync');
          self.historicSync.start({forceRPC:1}, function() {
            self.log('[p2p_sync] Done resync.');
          });
        } else if (err) {
          self.log('[p2p_sync] Error in handle Block: ', err);
        } else {
          self.sync.bDb.fromHashWithInfo(blockHash, function(err, detailedBlock) {
            if (err) {
              self.log('[p2p_sync] Error fetching detailed block info: ' + JSON.stringify(err));
              return;
            }

            var blockDetails = {
              hash: detailedBlock.info.hash,
              height: detailedBlock.info.height,
              time: detailedBlock.info.time,
              txlength: tx_hashes.length,
              size: payload_size,
              poolInfo: poolInfo || { url: "n/a", poolName: "Unknown" }
            };
            if (self.shouldBroadcast) {
              sockets.broadcastBlock(blockDetails);
            }
          });
        }
      });
    }
  });
};



PeerSync.prototype.handleConnected = function(data) {
  var peerman = data.pm;
  var peers_n = peerman.peers.length;
  this.log('[p2p_sync] Connected to ' + peers_n + ' peer' + (peers_n !== 1 ? 's' : ''));
};

PeerSync.prototype.run = function() {
  var self = this;

  this.peerdb.forEach(function(datum) {
    var peer = new Peer(datum.ipv4, datum.port);
    self.peerman.addPeer(peer);
  });

  this.peerman.on('connection', function(conn) {
    self.connected = true;
    conn.on('inv', self.handleInv.bind(self));
    conn.on('block', self.handleBlock.bind(self));
    conn.on('tx', self.handleTx.bind(self));
  });
  this.peerman.on('connect', self.handleConnected.bind(self));

  this.peerman.on('netDisconnected', function() {
    self.connected = false;
  });

  this.peerman.start();
};

PeerSync.prototype.close = function() {
  this.sync.close();
};


module.exports = require('soop')(PeerSync);

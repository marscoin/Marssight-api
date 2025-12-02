'use strict';

var imports     = require('soop').imports();

var bitcore         = require('Litecore'),
    RpcClient       = bitcore.RpcClient,
    BitcoreBlock    = bitcore.Block,
	util            = require('util'),
    config          = require('../config/config');

var  bitcoreRpc  = imports.bitcoreRpc || new RpcClient(config.bitcoind);
var logger = require('./logger').logger;

function Rpc() {
}

Rpc._parseTxResult = function(info) {
  logger.info('Raw TX data:', JSON.stringify(info));
  logger.info('Parsing RPC tx result:', {
    hasHex: !!info.hex,
    hasVin: !!info.vin,
    hasVout: !!info.vout,
    sample: info.vout ? info.vout[0] : null
  });
  var b  = new Buffer(info.hex,'hex');
  // remove fields we dont need, to speed and adapt the information
  delete info.hex;

  // Inputs => add index + coinBase flag
  var n =0;
  info.vin.forEach(function(i) {
    i.n = n++;
    if (i.coinbase) info.isCoinBase = true;
  });

  // Outputs => add total
  var valueOutSat = 0;
  info.vout.forEach( function(out, i) {
    logger.info('TX output #' + i + ' details:', JSON.stringify({
        value: out.value,
        type: out.scriptPubKey.type,
        desc: out.scriptPubKey.desc,
        address: out.scriptPubKey.address,
        addresses: out.scriptPubKey.addresses,
        asm: out.scriptPubKey.asm,
        hex: out.scriptPubKey.hex
      }));
    out.value = out.value.toFixed(8);
    valueOutSat += out.value * bitcore.util.COIN;
  });
  info.valueOut = valueOutSat.toFixed(0) / bitcore.util.COIN;
  info.size     = b.length;
  logger.info('Parsing RPC tx result:', {
    hasHex: !!info.hex,
    hasVin: !!info.vin,
    hasVout: !!info.vout,
    sample: info.vout ? info.vout[0] : null
  });
  return info;
};


Rpc.errMsg = function(err) {
  var e = err;
  e.message += util.format(' [Host: %s:%d User:%s Using password:%s]',
                            bitcoreRpc.host,
                            bitcoreRpc.port,
                            bitcoreRpc.user,
                            bitcoreRpc.pass?'yes':'no'
                          );
  return e;
};

Rpc.getTxInfo = function(txid, doNotParse, cb) {
  var self = this;
  if (typeof doNotParse === 'function') {
    cb = doNotParse;
    doNotParse = false;
  }

  // Add defensive check for undefined txid
  if (!txid) {
    logger.error('Attempted to get info for undefined txid');
    return cb(new Error('Cannot get transaction info: txid is undefined'));
  }

  logger.info('RPC getting tx info:', {
    txid: txid,
    doNotParse: doNotParse
  });

  bitcoreRpc.getRawTransaction(txid, 1, function(err, txInfo) {
    if (err && err.code === -5) {
      logger.info('RPC tx not found:', txid);
      return cb();
    }
    if (err) {
      logger.error('RPC error:', err);
      return cb(self.errMsg(err));
    }

    logger.info('RPC tx response:', {
      hasResult: !!txInfo.result,
      hasVin: txInfo.result && txInfo.result.vin ? true : false,
      vinLength: txInfo.result && txInfo.result.vin ? txInfo.result.vin.length : 0,
      hasVout: txInfo.result && txInfo.result.vout ? true : false,
      voutLength: txInfo.result && txInfo.result.vout ? txInfo.result.vout.length : 0,
      value: txInfo.result && txInfo.result.vout && txInfo.result.vout[0] ? txInfo.result.vout[0].value : null,
      n: txInfo.result && txInfo.result.vout && txInfo.result.vout[0] ? txInfo.result.vout[0].n : null
    });

    var info = doNotParse ? txInfo.result : self._parseTxResult(txInfo.result);
    return cb(null, info);
  });
};

Rpc.getTxInfo2 = function(txid, doNotParse, cb) {
  var self = this;
  if (typeof doNotParse === 'function') {
    cb = doNotParse;
    doNotParse = false;
  }
  
  logger.info('RPC getting tx info:', {
    txid: txid,
    doNotParse: doNotParse
  });
  
  bitcoreRpc.getRawTransaction(txid, 1, function(err, txInfo) {
    if (err && err.code === -5) {
      logger.info('RPC tx not found:', txid);
      return cb();
    }
    if (err) {
      logger.error('RPC error:', err);
      return cb(self.errMsg(err));
    }
    
    logger.info('RPC tx response:', {
      hasResult: !!txInfo.result,
      resultInspect: txInfo.result ? {
        hasVin: !!txInfo.result.vin,
        vinLength: txInfo.result.vin ? txInfo.result.vin.length : 0,
        hasVout: !!txInfo.result.vout,
        voutLength: txInfo.result.vout ? txInfo.result.vout.length : 0,
        sampleVout: txInfo.result.vout ? txInfo.result.vout[0] : null
      } : null
    });
    
    var info = doNotParse ? txInfo.result : self._parseTxResult(txInfo.result);
    return cb(null, info);
  });
};


Rpc.getTxInfoX = function(txid, doNotParse, cb) {
  var self = this;

  if (typeof doNotParse === 'function') {
    cb = doNotParse;
    doNotParse = false;
  }

  bitcoreRpc.getRawTransaction(txid, 1, function(err, txInfo) {
    // Not found?
    if (err && err.code === -5) return cb();
    if (err) return cb(self.errMsg(err));

    var info = doNotParse ? txInfo.result : self._parseTxResult(txInfo.result);
    return cb(null,info);
  });
};


Rpc.blockIndex = function(height, cb) {
  var self = this;

  bitcoreRpc.getBlockHash(height, function(err, bh){
    if (err) return cb(self.errMsg(err));
    cb(null, { blockHash: bh.result });
  });
};

Rpc._getBlockValue = function(height, cb) {
    var halvingBlocks = 150;
    var halvings = height / halvingBlocks;
    if (halvings >= 64)
        return 0;

    var reward = 50 * 100000000;
    reward >>= halvings;
    return reward;
};


Rpc.getBlock = function(hash, cb) {
  var self = this;

  bitcoreRpc.getBlock(hash, function(err,info) {
    // Not found?
    if (err && err.code === -5) return cb();
    if (err) return cb(self.errMsg(err));


    if (info.result.height)
      info.result.reward =  self._getBlockValue(info.result.height) / bitcore.util.COIN ;

    return cb(err,info.result);
  });
};



Rpc.sendRawTransaction = function(rawtx, cb) {
  bitcoreRpc.sendRawTransaction(rawtx, function(err, txid) {
    if (err) return cb(err);

    return cb(err, txid.result);
  });
};

Rpc.verifyMessage = function(address, signature, message, cb) {
  var self = this;
  bitcoreRpc.verifyMessage(address, signature, message, function(err, message) {
    if (err && (err.code === -3 || err.code === -5))
      return cb(err);  // -3 = invalid address, -5 = malformed base64 / etc.
    if (err)
      return cb(self.errMsg(err));

    return cb(err, message.result);
  });
};

module.exports = require('soop')(Rpc);



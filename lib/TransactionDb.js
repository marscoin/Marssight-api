'use strict';

var imports = require('soop').imports();



// to show tx outs
var OUTS_PREFIX = 'txo-'; //txo-<txid>-<n> => [addr, btc_sat]
var SPENT_PREFIX = 'txs-'; //txs-<txid(out)>-<n(out)>-<txid(in)>-<n(in)> = ts

// to sum up addr balance (only outs, spents are gotten later)
var ADDR_PREFIX = 'txa2-'; //txa-<addr>-<tsr>-<txid>-<n> 
// tsr = 1e13-js_timestamp
// => + btc_sat [:isConfirmed:[scriptPubKey|isSpendConfirmed:SpentTxid:SpentVout:SpentTs]
// |balance:txApperances


// TODO: use bitcore networks module
var genesisTXID = '4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b';
var CONCURRENCY = 10;
var DEFAULT_SAFE_CONFIRMATIONS = 6;

var MAX_OPEN_FILES = 500;
var END_OF_WORLD_TS = 1e13;
//  var CONFIRMATION_NR_TO_NOT_CHECK = 10;  //Spend
/**
 * Module dependencies.
 */

var bitcore = require('Litecore'),
  Rpc = imports.rpc || require('./Rpc'),
  util = bitcore.util,
  networks = bitcore.networks,
  leveldb = require('./leveldb'),
  async = require('async'),
  config = require('../config/config'),
  assert = require('assert'),
  Script = bitcore.Script,
  bitcoreUtil = bitcore.util,
  bufferUtils = require('./bufferUtils');

var logger = require('./logger').logger;

var db = imports.db || leveldb.levelup(config.leveldb + '/txs', {
  maxOpenFiles: MAX_OPEN_FILES
});
var PoolMatch = imports.poolMatch || require('soop').load('./PoolMatch', config);
// Pure JS base58 implementation - no native dependencies
var base58 = require('./base58').base58Check;
var encodedData = require('soop').load('Litecore/util/EncodedData', {
  base58: base58
});
var versionedData = require('soop').load('Litecore/util/VersionedData', {
  parent: encodedData
});

var Address = require('soop').load('Litecore/lib/Address', {
  parent: versionedData
});



var TransactionDb = function() {
  TransactionDb.super(this, arguments);
  this.network = config.network === 'testnet' ? networks.testnet : networks.livenet;
  this.poolMatch = new PoolMatch();
  this.safeConfirmations = config.safeConfirmations || DEFAULT_SAFE_CONFIRMATIONS;

  this._db = db; // this is only exposed for migration script
};

TransactionDb.prototype.close = function(cb) {
  db.close(cb);
};

TransactionDb.prototype.drop = function(cb) {
  var path = config.leveldb + '/txs';
  db.close(function() {
    leveldb.destroy(path, function() {
      db = leveldb.levelup(path, {
        maxOpenFiles: 500
      });
      return cb();
    });
  });
};

TransactionDb.prototype._addSpentInfo = function(r, txid, index, ts) {
  if (r.spentTxId) {
    if (!r.multipleSpentAttempts) {
      r.multipleSpentAttempts = [{
        txid: r.spentTxId,
        index: r.index,
      }];
    }
    r.multipleSpentAttempts.push({
      txid: txid,
      index: parseInt(index),
    });
  } else {
    r.spentTxId = txid;
    r.spentIndex = parseInt(index);
    r.spentTs = parseInt(ts);
  }
};


// This is not used now
TransactionDb.prototype.fromTxId = function(txid, cb) {
  var self = this;
  var k = OUTS_PREFIX + txid;
  var ret = [];
  var idx = {};
  var i = 0;

  // outs.
  db.createReadStream({
    start: k,
    end: k + '~'
  })
    .on('data', function(data) {
      var k = data.key.split('-');
      var v = data.value.split(':');
      ret.push({
        addr: v[0],
        value_sat: parseInt(v[1]),
        index: parseInt(k[2]),
      });
      idx[parseInt(k[2])] = i++;
    })
    .on('error', function(err) {
      return cb(err);
    })
    .on('end', function() {

      var k = SPENT_PREFIX + txid + '-';
      db.createReadStream({
        start: k,
        end: k + '~'
      })
        .on('data', function(data) {
          var k = data.key.split('-');
          var j = idx[parseInt(k[2])];

          assert(typeof j !== 'undefined', 'Spent could not be stored: tx ' + txid +
            'spent in TX:' + k[1] + ',' + k[2] + ' j:' + j);

          self._addSpentInfo(ret[j], k[3], k[4], data.value);
        })
        .on('error', function(err) {
          return cb(err);
        })
        .on('end', function(err) {
          return cb(err, ret);
        });
    });
};


TransactionDb.prototype._fillSpent = function(info, cb) {
  var self = this;

  if (!info) return cb();

  var k = SPENT_PREFIX + info.txid + '-';
  db.createReadStream({
    start: k,
    end: k + '~'
  })
    .on('data', function(data) {
      var k = data.key.split('-');
      self._addSpentInfo(info.vout[k[2]], k[3], k[4], data.value);
    })
    .on('error', function(err) {
      return cb(err);
    })
    .on('end', function(err) {
      return cb(err);
    });
};


TransactionDb.prototype._fillOutpoints = function(txInfo, cb) {
  var self = this;

  if (!txInfo || txInfo.isCoinBase) return cb();

  var valueIn = 0;
  var incompleteInputs = 0;

  async.eachLimit(txInfo.vin, CONCURRENCY, function(i, c_in) {
      self.fromTxIdN(i.txid, i.vout, function(err, ret) {
        if (!ret || !ret.addr || !ret.valueSat) {
          logger.info('Could not get TXouts in %s,%d from %s ', i.txid, i.vout, txInfo.txid);
          if (ret) i.unconfirmedInput = ret.unconfirmedInput;
          incompleteInputs = 1;
          return c_in(); // error not scalated
        }

        txInfo.firstSeenTs = ret.ts;
        i.addr = ret.addr;
        i.valueSat = ret.valueSat;
        i.value = ret.valueSat / util.COIN;
        valueIn += i.valueSat;

        if (ret.multipleSpentAttempt || !ret.spentTxId ||
          (ret.spentTxId && ret.spentTxId !== txInfo.txid)
        ) {
          if (ret.multipleSpentAttempts) {
            ret.multipleSpentAttempts.forEach(function(mul) {
              if (mul.spentTxId !== txInfo.txid) {

                i.doubleSpentTxID = ret.spentTxId;
                i.doubleSpentIndex = ret.spentIndex;
              }
            });
          } else if (!ret.spentTxId) {
            i.dbError = 'Input spent not registered';
          } else {

            i.doubleSpentTxID = ret.spentTxId;
            i.doubleSpentIndex = ret.spentIndex;
          }
        } else {
          i.doubleSpentTxID = null;
        }
        return c_in();
      });
    },
    function() {
      if (!incompleteInputs) {
        txInfo.valueIn = valueIn / util.COIN;
        txInfo.fees = (valueIn - (txInfo.valueOut * util.COIN)).toFixed(0) / util.COIN;
      } else {
        txInfo.incompleteInputs = 1;
      }
      return cb();
    });
};


TransactionDb.prototype._getInfo = function(txid, next) {
  var self = this;

  logger.info('Calling getTxInfo for txid:', txid);
  Rpc.getTxInfo(txid, function(err, txInfo) {
    // Handle RPC errors or missing transaction
    if (err || !txInfo) {
      logger.error('Error getting tx info:', err || 'Transaction not found');
      return next(err || new Error('Transaction not found'));
    }
    
    // Only proceed with valid txInfo
    logger.info('Got txInfo:', {
      txid: txInfo.txid,
      isCoinBase: txInfo.isCoinBase,
      hasVin: !!txInfo.vin,
      vinLength: txInfo.vin ? txInfo.vin.length : 0,
      firstVin: txInfo.vin && txInfo.vin[0] ? {
        coinbase: txInfo.vin[0].coinbase,
        hasCoinbase: !!txInfo.vin[0].coinbase
      } : null
    });

    self._fillOutpoints(txInfo, function() {
      // Add merge mining detection here
      if (txInfo.isCoinBase && txInfo.vin && txInfo.vin[0] && txInfo.vin[0].coinbase) {
        txInfo.vin[0].isMergeMined = txInfo.vin[0].coinbase.includes('6d6d');
        logger.info('Merge mining detection:', {
          coinbase: txInfo.vin[0].coinbase,
          isMergeMined: txInfo.vin[0].isMergeMined
        });
      }

      self._fillSpent(txInfo, function() {
        logger.info('Final txInfo:', {
          txid: txInfo.txid,
          isCoinBase: txInfo.isCoinBase,
          isMergeMined: txInfo.isMergeMined
        });
        return next(null, txInfo);
      });
    });
  });
};


// Simplified / faster Info version: No spent / outpoints info.
TransactionDb.prototype.fromIdInfoSimple = function(txid, cb) {
  Rpc.getTxInfo(txid, true, function(err, info) {
    if (err) return cb(err);
    if (!info) return cb();
    return cb(err, info);
  });
};

TransactionDb.prototype.fromIdWithInfo = function(txid, cb) {
  var self = this;

  self._getInfo(txid, function(err, info) {
    if (err) return cb(err);
    if (!info) return cb();
    return cb(err, {
      txid: txid,
      info: info
    });
  });
};

TransactionDb.prototype.fromTxIdN = function(txid, n, cb) {
  var self = this;
  var k = OUTS_PREFIX + txid + '-' + n;

  logger.info('Attempting DB lookup with key:', k);
  db.get(k, function(err, val) {
    var ret;

    if (!val || (err && err.notFound)) {
      logger.info('DB lookup failed for key:', k, 'Error:', err ? err.message : 'No value');
      err = null;
      ret = {
        unconfirmedInput: 1
      };
    } else {
      var a = val.split(':');
      ret = {
        addr: a[0],
        valueSat: parseInt(a[1]),
      };
      logger.info('Successfully found output:', ret);
    }

    // Add RPC fallback for transaction confirmation status
    if (ret.unconfirmedInput) {
      Rpc.getTxInfo(txid, function(rpcErr, txInfo) {
        if (!rpcErr && txInfo && txInfo.confirmations && txInfo.confirmations > 0) {
          ret.isConfirmed = true;
          ret.confirmations = txInfo.confirmations;
          ret.unconfirmedInput = false;
          logger.info('RPC fallback confirmed transaction:', {
            txid: txid,
            confirmations: txInfo.confirmations
          });
        }

        // Continue with the spent check regardless of RPC result
        checkSpent();
      });
    } else {
      checkSpent();
    }

    // Check if output is spent
    function checkSpent() {
      var k = SPENT_PREFIX + txid + '-' + n + '-';
      db.createReadStream({
        start: k,
        end: k + '~'
      })
        .on('data', function(data) {
          var k = data.key.split('-');
          self._addSpentInfo(ret, k[3], k[4], data.value);
        })
        .on('error', function(error) {
          return cb(error);
        })
        .on('end', function() {
          return cb(null, ret);
        });
    }
  });
};

// Gets address info from an outpoint
TransactionDb.prototype.fromTxIdN2 = function(txid, n, cb) {
  var self = this;
  var k = OUTS_PREFIX + txid + '-' + n;
  //logger.info('Attempting DB lookup with key:', k);
  db.get(k, function(err, val) {
    var ret;

    if (!val || (err && err.notFound)) {
      logger.info('DB lookup failed for key:', k, 'Error:', err ? err.message : 'No value');
      err = null;
      ret = {
        unconfirmedInput: 1
      };
    } else {
      var a = val.split(':');
      ret = {
        addr: a[0],
        valueSat: parseInt(a[1]),
      };
      logger.info('Successfully found output:', ret);
    }

    // spent?
    var k = SPENT_PREFIX + txid + '-' + n + '-';
    db.createReadStream({
      start: k,
      end: k + '~'
    })
      .on('data', function(data) {
        var k = data.key.split('-');
        self._addSpentInfo(ret, k[3], k[4], data.value);
      })
      .on('error', function(error) {
        return cb(error);
      })
      .on('end', function() {
        return cb(null, ret);
      });
  });
};


TransactionDb.prototype.fromTxIdNY = function(txid, n, cb) {
  var self = this;
  
  // Input validation
  if (!txid || typeof n !== 'number') {
    //logger.error('Invalid parameters: txid=' + txid + ', n=' + n);
    return cb(new Error('Invalid parameters'));
  }

  var k = OUTS_PREFIX + txid + '-' + n;
  logger.info('Attempting DB lookup with key:', k);

  // First lookup the output
  db.get(k, function(err, val) {
    var ret;

    if (!val || (err && err.notFound)) {
      logger.info('DB lookup failed for key:', k, 'Error:', err ? err.message : 'No value');
      err = null;
      ret = {
        unconfirmedInput: 1,
        lookupAttempted: true,
        addr: '',           // Initialize empty address
        valueSat: 0,       // Initialize value in satoshis to 0
        value: 0           // Initialize value to 0
      };
    } else {
      try {
        var a = val.split(':');
        ret = {
          addr: a[0],
          valueSat: parseInt(a[1]),
          lookupAttempted: true
        };
        logger.info('Successfully found output:', ret);
      } catch (e) {
        logger.error('Error parsing output value:', e);
        ret = { 
          unconfirmedInput: 1,
          parseError: true,
          lookupAttempted: true
        };
      }
    }

    // Look up spent info
    var spentKey = SPENT_PREFIX + txid + '-' + n + '-';
    var foundSpentTxs = false;

    db.createReadStream({
      start: spentKey,
      end: spentKey + '~'
    })
    .on('data', function(data) {
      foundSpentTxs = true;
      var spentParts = data.key.split('-');
      
      // If this was an unconfirmed input, try to get full info from RPC
      if (ret.unconfirmedInput) {
        Rpc.getTxInfo(txid, function(rpcErr, txInfo) {
          if (!rpcErr && txInfo && txInfo.vout && txInfo.vout[n]) {
            try {
              // Handle different scriptPubKey formats
              if (txInfo.vout[n].scriptPubKey && 
                  txInfo.vout[n].scriptPubKey.addresses && 
                  txInfo.vout[n].scriptPubKey.addresses.length > 0) {
                ret.addr = txInfo.vout[n].scriptPubKey.addresses[0];
              } else if (txInfo.vout[n].scriptPubKey && 
                        txInfo.vout[n].scriptPubKey.address) {
                ret.addr = txInfo.vout[n].scriptPubKey.address;
              }

              // Make sure we always set both value and valueSat
              if (typeof txInfo.vout[n].value === 'number') {
                ret.value = txInfo.vout[n].value;
                ret.valueSat = parseInt((txInfo.vout[n].value * 1e8).toFixed(0));
              } else if (txInfo.vout[n].valueSat) {
                ret.valueSat = parseInt(txInfo.vout[n].valueSat);
                ret.value = ret.valueSat / 1e8;
              }
              
              // Remove unconfirmedInput flag since we now have the data
              if (ret.addr && (ret.value || ret.valueSat)) {
                delete ret.unconfirmedInput;
              }
              
              logger.info('Retrieved missing tx info from RPC for txid: ' + txid + 
                         ' value: ' + ret.value + 
                         ' valueSat: ' + ret.valueSat + 
                         ' addr: ' + ret.addr);
            } catch(e) {
              logger.error('Error processing RPC txInfo:', e);
            }
          }
        });
      }

      self._addSpentInfo(ret, spentParts[3], spentParts[4], data.value);
      logger.info('Found spent info for key: ' + data.key);
    })
    .on('error', function(error) {
      logger.error('Error in spent info lookup:', error);
      return cb(error);
    })
    .on('end', function() {
      if (!foundSpentTxs) {
        logger.info('No spent transactions found for key: ' + spentKey);
      }
      return cb(null, ret);
    });
  });
};

// Gets address info from an outpoint
TransactionDb.prototype.fromTxIdNX = function(txid, n, cb) {
  var self = this;
  var k = OUTS_PREFIX + txid + '-' + n;
  
  logger.info('Attempting DB lookup with key:', k);
  db.get(k, function(err, val) {
    var ret;

    if (!val || (err && err.notFound)) {
      logger.info('DB lookup failed for key:', k, 'Error:', err);
      err = null;
      ret = {
        unconfirmedInput: 1
      };
    } else {
      var a = val.split(':');
      ret = {
        addr: a[0],
        valueSat: parseInt(a[1]),
      };
    }

    // spent?
    var k = SPENT_PREFIX + txid + '-' + n + '-';
    db.createReadStream({
      start: k,
      end: k + '~'
    })
      .on('data', function(data) {
        var k = data.key.split('-');
        self._addSpentInfo(ret, k[3], k[4], data.value);
	logger.info('Found related DB entry:', data.key, data.value);
      })
      .on('error', function(error) {
        return cb(error);
      })
      .on('end', function() {
        return cb(null, ret);
      });
  });
};


TransactionDb.prototype.deleteCacheForAddress = function(addr, cb) {
  var k = ADDR_PREFIX + addr + '-';
  var dbScript = [];
  db.createReadStream({
    start: k,
    end: k + '~'
  })
    .on('data', function(data) {
      var v = data.value.split(':');
      dbScript.push({
        type: 'put',
        key: data.key,
        value: v[0],
      });
    })
    .on('error', function(err) {
      return cb(err);
    })
    .on('end', function() {
      db.batch(dbScript, cb);
    });
};

TransactionDb.prototype.cacheConfirmations = function(txouts, cb) {
  var self = this;

  var dbScript = [];
  for (var ii in txouts) {
    var txout = txouts[ii];

    //everything already cached?
    if (txout.spentIsConfirmedCached) {
      continue;
    }

    var infoToCache = [];
    if (txout.confirmations >= self.safeConfirmations) {

      if (txout.spentConfirmations >= self.safeConfirmations) {
        // if spent, we overwrite scriptPubKey cache (not needed anymore)
        // First 1 = txout.isConfirmedCached (must be equal to 1 at this point)
        infoToCache = [1, 1, txout.spentTxId, txout.spentIndex, txout.spentTs];
      } else {
        if (!txout.isConfirmedCached) {
          infoToCache.push(1);
          txout.confirmedWillBeCached = 1;
        }
      }
      //console.log('[TransactionDb.js.352:infoToCache:]',infoToCache); //TODO
      if (infoToCache.length) {

        infoToCache.unshift(txout.value_sat);
        dbScript.push({
          type: 'put',
          key: txout.key,
          value: infoToCache.join(':'),
        });
      }
    }
  }

  //console.log('[TransactionDb.js.339:dbScript:]',dbScript); //TODO
  db.batch(dbScript, cb);
};


TransactionDb.prototype.cacheScriptPubKey = function(txouts, cb) {
  //  console.log('[TransactionDb.js.381:cacheScriptPubKey:]'); //TODO
  var self = this;
  var dbScript = [];
  for (var ii in txouts) {
    var txout = txouts[ii];
    //everything already cached?
    if (txout.scriptPubKeyCached || txout.spentTxId) {
      continue;
    }

    if (txout.scriptPubKey) {
      var infoToCache = [txout.value_sat, (txout.isConfirmedCached || txout.confirmedWillBeCached) ? 1 : 0, txout.scriptPubKey];
      dbScript.push({
        type: 'put',
        key: txout.key,
        value: infoToCache.join(':'),
      });
    }
  }
  db.batch(dbScript, cb);
};

//New function created for an update in Address.js that
//introduced the need for this function as per AI
TransactionDb.prototype.fillScriptPubKey = function(txOuts, next) {
  var self = this;

  if (!txOuts || !txOuts.length) return next();

  async.eachLimit(txOuts, CONCURRENCY, function(txOut, callback) {
    // Skip if already has scriptPubKey
    if (txOut.scriptPubKey) return callback();

    // Try to get from RPC if transaction output doesn't have scriptPubKey
    Rpc.getTxInfo(txOut.txid, function(rpcErr, txInfo) {
      if (!rpcErr && txInfo && txInfo.vout && txInfo.vout[txOut.index]) {
        try {
          // Get scriptPubKey from RPC result
          if (txInfo.vout[txOut.index].scriptPubKey &&
              txInfo.vout[txOut.index].scriptPubKey.hex) {
            txOut.scriptPubKey = txInfo.vout[txOut.index].scriptPubKey.hex;

            // Also cache it for future use
            if (!txOut.scriptPubKeyCached) {
              var key = OUTS_PREFIX + txOut.txid + '-' + txOut.index;
              var infoToCache = [
                txOut.value_sat,
                (txOut.isConfirmed ? 1 : 0),
                txOut.scriptPubKey
              ];
              db.put(key, infoToCache.join(':'), function(err) {
                if (err) logger.error('Error caching scriptPubKey:', err);
              });
              txOut.scriptPubKeyCached = true;
            }
          }
        } catch(e) {
          logger.error('Error processing RPC txInfo for scriptPubKey:', e);
        }
      }
      return callback();
    });
  }, function(err) {
    if (err) logger.error('Error in fillScriptPubKey:', err);
    return next();
  });
};


TransactionDb.prototype._parseAddrData = function(k, data, ignoreCache) {
  var v = data.value.split(':');
  // console.log('[TransactionDb.js.375]',data.key,data.value);
  var item = {
    key: data.key,
    ts: END_OF_WORLD_TS - parseInt(k[2]),
    txid: k[3],
    index: parseInt(k[4]),
    value_sat: parseInt(v[0]),
  };

  if (ignoreCache)
    return item;

  // Cache: 
  //  v[1]== isConfirmedCached
  //  v[2]=== '1' -> is SpendCached -> [4]=spendTxId [5]=spentIndex [6]=spendTs
  //  v[2]!== '1' -> is ScriptPubkey -> [[2] = scriptPubkey
  if (v[1] === '1') {
    item.isConfirmed = 1;
    item.isConfirmedCached = 1;
    // console.log('[TransactionDb.js.356] CACHE HIT CONF:', item.key);
    // Sent, confirmed
    if (v[2] === '1') {
      // console.log('[TransactionDb.js.356] CACHE HIT SPENT:', item.key, 
      item.spentIsConfirmed = 1;
      item.spentIsConfirmedCached = 1;
      item.spentTxId = v[3];
      item.spentIndex = parseInt(v[4]);
      item.spentTs = parseInt(v[5]);
    }
    // Scriptpubkey cached
    else if (v[2]) {
      item.scriptPubKey = v[2];
      item.scriptPubKeyCached = 1;
      //  console.log('[TransactionDb.js.356] CACHE HIT SCRIPTPUBKEY:', item.key, v, item.scriptPubKey);
    }
  }
  return item;
};

TransactionDb.prototype.fromAddr = function(addr, opts, cb) {
  opts = opts || {};
  var self = this;
  var k = ADDR_PREFIX + addr + '-';
  var ret = [];
  var unique = {};

  db.createReadStream({
    start: k,
    end: k + '~',
    limit: opts.txLimit > 0 ? opts.txLimit : -1, // -1 means not limit
  })
    .on('data', function(data) {
      var k = data.key.split('-');
      var index = k[3] + k[4];
      if (!unique[index]) {
        unique[index] = 1;
        ret.push(self._parseAddrData(k, data, opts.ignoreCache));
      }
    })
    .on('error', cb)
    .on('end', function() {
      async.eachLimit(ret.filter(function(x) {
          return !x.spentIsConfirmed;
        }), CONCURRENCY, function(o, e_c) {
          var k = SPENT_PREFIX + o.txid + '-' + o.index + '-';
          db.createReadStream({
            start: k,
            end: k + '~'
          })
            .on('data', function(data) {
              var k = data.key.split('-');
              self._addSpentInfo(o, k[3], k[4], data.value);
            })
            .on('error', e_c)
            .on('end', e_c);
        },
        function(err) {
          return cb(err, ret);
        });
    });
};

TransactionDb.prototype._fromBuffer = function(buf) {
  var buf2 = bufferUtils.reverse(buf);
  return parseInt(buf2.toString('hex'), 16);
};

TransactionDb.prototype._detectMergeMining = function(coinbaseHex) {
  logger.info('Checking coinbase for merge mining:', coinbaseHex);
  
  if (!coinbaseHex) {
    logger.info('No coinbase hex found');
    return false;
  }
  
  const hasMM = coinbaseHex.includes('6d6d');
  logger.info('Merge mining detected:', hasMM);
  return hasMM;
};

TransactionDb.prototype.getStandardizedTx = function(tx, time, isCoinBase) {
  var self = this;
  tx.txid = bitcoreUtil.formatHashFull(tx.getHash());
  var ti = 0;

  tx.vin = tx.ins.map(function(txin) {
    var ret = {
      n: ti++
    };
    if (isCoinBase) {
      ret.isCoinBase = true;
      logger.info('Processing coinbase transaction:', txin);
      if (txin.coinbase) {
        ret.isMergeMined = self._detectMergeMining(txin.coinbase);
        logger.info('Set isMergeMined to:', ret.isMergeMined);
      }
    } else {
      ret.txid = bufferUtils.reverse(new Buffer(txin.getOutpointHash())).toString('hex');
      ret.vout = txin.getOutpointIndex();
    }
    return ret;
  });

  var to = 0;
  tx.vout = tx.outs.map(function(txout) {
    var val;
    if (txout.s) {
      // Handle old format
      var s = new Script(txout.s);
      var addrs = new Address.fromScriptPubKey(s, config.network);
      // support only for p2pubkey p2pubkeyhash and p2sh
      if (addrs && addrs.length === 1) {
        val = {
          addresses: [addrs[0].toString()]
        };
      }
    } else if (txout.scriptPubKey && txout.scriptPubKey.desc) {
      // Handle new format with descriptor
      var descMatch = txout.scriptPubKey.desc.match(/addr\((.*?)\)/);
      if (descMatch) {
        val = {
          addresses: [descMatch[1]]
        };
      }
    }

    return {
      valueSat: self._fromBuffer(txout.v),
      scriptPubKey: val,
      n: to++,
    };
  });
  tx.time = time;
  return tx;
};


TransactionDb.prototype.getStandardizedTxR = function(tx, time, isCoinBase) {
  var self = this;
  tx.txid = bitcoreUtil.formatHashFull(tx.getHash());
  
  logger.info('Raw transaction:', {
    isCoinBase: isCoinBase,
    txid: tx.txid,
    hasIns: !!tx.ins,
    insLength: tx.ins ? tx.ins.length : 0,
    hasOuts: !!tx.outs,
    outsLength: tx.outs ? tx.outs.length : 0
  });
  
  var ti = 0;
  tx.vin = tx.ins.map(function(txin) {
    var ret = {
      n: ti++
    };
    if (isCoinBase) {
      ret.isCoinBase = true;
      logger.info('Coinbase input details:', {
        input: txin
      });
    } else {
      ret.txid = bufferUtils.reverse(new Buffer(txin.getOutpointHash())).toString('hex');
      ret.vout = txin.getOutpointIndex();
    }
    return ret;
  }); 
    
  var to = 0;
  tx.vout = tx.outs.map(function(txout) {
    var val;
    logger.info('Raw output data:', {
    	scriptPubKey: txout.s ? txout.s.toString('hex') : null,
    	rawOutput: JSON.stringify(txout, null, 2)
    });
    logger.info('Output raw details:', {
      hasScript: !!txout.s,
      scriptBuffer: txout.s ? txout.s.toString('hex') : null,
      scriptLength: txout.s ? txout.s.length : 0
    });
    
    if (txout.s) {
      try {
        var s = new Script(txout.s);
        logger.info('Created script:', {
          scriptType: s.getOutType(),
          chunks: s.chunks.map(function(chunk) {
            return chunk.toString('hex');
          })
        });
        
        var addrs = new Address.fromScriptPubKey(s, config.network);
        logger.info('Address extraction:', {
          success: !!addrs,
          count: addrs ? addrs.length : 0,
          addresses: addrs ? addrs.map(function(a) { return a.toString(); }) : []
        });
        
        if (addrs && addrs.length === 1) {
          val = {
            addresses: [addrs[0].toString()]
          };
        }
      } catch(e) {
        logger.error('Script processing error:', e);
      }
    }
    
    var result = {
      valueSat: self._fromBuffer(txout.v),
      scriptPubKey: val,
      n: to++,
    };
    
    logger.info('Final output:', result);
    
    return result;
  });
  tx.time = time;
  return tx;
};


TransactionDb.prototype.getStandardizedTx = function(tx, time, isCoinBase) {
  var self = this;
  logger.info('[getStandardizedTx] Starting processing tx:', tx.txid || tx.hash);
  tx.txid = bitcoreUtil.formatHashFull(tx.getHash());
  var ti = 0;

  tx.vin = tx.ins.map(function(txin) {
    var ret = {
      n: ti++
    };
    if (isCoinBase) {
      ret.isCoinBase = true;
    } else {
      ret.txid = bufferUtils.reverse(new Buffer(txin.getOutpointHash())).toString('hex');
      ret.vout = txin.getOutpointIndex();
    }
    return ret;
  });

  var to = 0;
  tx.vout = tx.outs.map(function(txout) {
    var val;
    logger.info('[getStandardizedTx] Processing output #' + to);
    
    if (txout.s) {
      logger.info('[getStandardizedTx] Found old format output with script');
      var s = new Script(txout.s);
      var addrs = new Address.fromScriptPubKey(s, config.network);
      // support only for p2pubkey p2pubkeyhash and p2sh
      if (addrs && addrs.length === 1) {
        val = {
          addresses: [addrs[0].toString()]
        };
        logger.info('[getStandardizedTx] Extracted address:', addrs[0].toString());
      }
     } else if (txout.scriptPubKey) {
      logger.info('[getStandardizedTx] Found scriptPubKey:', JSON.stringify(txout.scriptPubKey));
      if (txout.scriptPubKey.desc) {
        var match = txout.scriptPubKey.desc.match(/addr\((.*?)\)/);
        if (match) {
          val = {
            addresses: [match[1]]
          };
          logger.info('[getStandardizedTx] Extracted address from desc:', match[1]);
        }
      } else if (txout.scriptPubKey.addresses) {
        val = {
          addresses: txout.scriptPubKey.addresses
        };
        logger.info('[getStandardizedTx] Using scriptPubKey addresses:', txout.scriptPubKey.addresses);
      } else if (txout.scriptPubKey.type === 'pubkey' && txout.scriptPubKey.hex) {
        try {
          addr = handlePubKeyOutput(txout.scriptPubKey, config.network);
          // // First try using Script parsing
          // var s = new Script(txout.scriptPubKey.hex);
          // var addrs = new Address.fromScriptPubKey(s, config.network);
          // if (addrs && addrs.length === 1) {
          //   val = {
          //     addresses: [addrs[0].toString()]
          //   };
          // }
          val = {
            addresses: [addr]
          };

          // // If Script parsing fails, fall back to manual pubkey extraction
          // if (!val) {
          //   var pubKeyHex = txout.scriptPubKey.hex.slice(2, -2); // Remove OP_PUSHDATA and OP_CHECKSIG
          //   var pubKey = new Buffer(pubKeyHex, 'hex');
          //   logger.info("Pubkey Hex:", pubKeyHex);
          //   var addrs = new Address.fromPubKey(s, config.network);
          //   val = {
          //     addresses: [addrs[0].toString()]
          //   };
          // }

          logger.info('Pubkey conversion result:', {
            originalHex: txout.scriptPubKey.hex,
            extractedPubKey: pubKeyHex,
            derivedAddress: val.addresses[0]
          });
        } catch(e) {
          logger.error('Failed to convert pubkey to address:', {
            error: e.toString(),
            hex: txout.scriptPubKey.hex,
            stack: e.stack
          });
        }
      }
    }

    var ret = {
      valueSat: self._fromBuffer(txout.v),
      scriptPubKey: val,
      n: to++,
    };
    logger.info('[getStandardizedTx] Output result:', JSON.stringify(ret));
    return ret;
  });
  tx.time = time;

  logger.info('[getStandardizedTx] Final tx:', JSON.stringify({
    txid: tx.txid,
    vin: tx.vin.length,
    vout: tx.vout.length,
    time: tx.time
  }));

  return tx;
};


function handlePubKeyOutput(scriptPubKey, network) {
  try {
    // Handle both compressed (33 bytes) and uncompressed (65 bytes) public keys
    var pubKeyHex = scriptPubKey.hex;
    
    // Remove OP_PUSHDATA if present (0x41 for 65 bytes or 0x21 for 33 bytes)
    if (pubKeyHex.indexOf('41') === 0 || pubKeyHex.indexOf('21') === 0) {
      pubKeyHex = pubKeyHex.slice(2);
    }
    
    // Remove OP_CHECKSIG if present
    if (pubKeyHex.indexOf('ac', pubKeyHex.length - 2) !== -1) {
      pubKeyHex = pubKeyHex.slice(0, -2);
    }

    // Validate public key length
    var pubKeyBuffer = new Buffer(pubKeyHex, 'hex');
    if (pubKeyBuffer.length !== 33 && pubKeyBuffer.length !== 65) {
      throw new Error('Invalid public key length: ' + pubKeyBuffer.length);
    }

    // Create address from public key
    var addr = Address.fromPubKey(pubKeyBuffer, network);
    return addr.toString();
  } catch (e) {
    logger.error('Public key processing error:', {
      originalHex: scriptPubKey.hex,
      error: e.message,
      stack: e.stack
    });
    return null;
  }
}

TransactionDb.prototype._addScript = function(tx, relatedAddrs) {
  var dbScript = [];
  var ts = tx.time;
  var txid = tx.txid || tx.hash;
  logger.info('Processing transaction for storage:', {
    txid: txid,
    time: ts,
    vinLength: tx.vin ? tx.vin.length : 0,
    voutLength: tx.vout ? tx.vout.length : 0
  });
  // Input Outpoints (mark them as spent)
  for (var ii in tx.vin) {
    var i = tx.vin[ii];
    if (i.txid) {
      var k = SPENT_PREFIX + i.txid + '-' + i.vout + '-' + txid + '-' + i.n;
      dbScript.push({
        type: 'put',
        key: k,
        value: ts || 0,
      });
      logger.info('Adding spent info:', {
        key: k,
        value: ts || 0 
      }); 
    } else { 
      logger.info('Input has no txid (likely coinbase):', {
        input: i,
        index: ii
      });
    }
  }

  for (var ii in tx.vout) {
    var o = tx.vout[ii];
    logger.info('Processing output:', {
      index: ii,
      hasScriptPubKey: !!o.scriptPubKey,
      hasAddresses: !!(o.scriptPubKey && o.scriptPubKey.addresses),
      hasAddress: !!(o.scriptPubKey && o.scriptPubKey.address),
      value: o.value,
      valueSat: o.valueSat,
      type: o.scriptPubKey ? o.scriptPubKey.type : null
    });

    logger.info('Examining output type:', {
      type: o.scriptPubKey ? o.scriptPubKey.type : 'unknown',
      hex: o.scriptPubKey ? o.scriptPubKey.hex : null
    });

    var addr = null;
    if (o.scriptPubKey) {
      if (o.scriptPubKey.address || (o.scriptPubKey.addresses && o.scriptPubKey.addresses[0])) {
        addr = o.scriptPubKey.address || o.scriptPubKey.addresses[0];
        logger.info('Found standard address:', addr);
      } 
      else if (o.scriptPubKey.type === 'pubkey' && o.scriptPubKey.hex) {
        try {
          addr = handlePubKeyOutput(o.scriptPubKey, config.network);
          // logger.info("ScriptPubKey Hex:", o.scriptPubKey.hex);
          // // First try using Script parsing
          // var s = new Script(o.scriptPubKey.hex);
          // var addrs = new Address.fromScriptPubKey(s, config.network);
          // if (addrs && addrs.length === 1) {
          //   addr = addrs[0].toString();
          // }

          // // If Script parsing fails, fall back to manual pubkey extraction
          // if (!addr) {
          //   var pubKeyHex = o.scriptPubKey.hex.slice(2, -2); // Remove OP_PUSHDATA and OP_CHECKSIG
          //   var pubKey = new Buffer(pubKeyHex, 'hex');
          //   logger.info("Pubkey Hex:", pubKeyHex);
          //   var addrs = new Address.fromPubKey(s, config.network);
          //   val = {
          //     addresses: [addrs[0].toString()]
          //   };
          // }

          logger.info('Pubkey conversion result:', {
            originalHex: o.scriptPubKey.hex,
            derivedAddress: addr
          });
        } catch(e) {
          logger.error('Failed to convert pubkey to address:', {
            error: e.toString(),
            hex: o.scriptPubKey.hex,
            stack: e.stack
          });
          process.exit(1);
        }
      }
    }

    if (addr) {
      var sat = o.valueSat || ((o.value || 0) * util.COIN).toFixed(0);
      if (relatedAddrs) relatedAddrs[addr] = 1;
      var k = OUTS_PREFIX + txid + '-' + o.n;
      var tsr = END_OF_WORLD_TS - ts;
      logger.info('Storing output:', {
        key: k,
        value: addr + ':' + sat,
        address: addr,
        satoshis: sat,
        timestamp: ts,
        timestampReverse: tsr
      });
      dbScript.push({
        type: 'put',
        key: k,
        value: addr + ':' + sat,
      }, {
        type: 'put',
        key: ADDR_PREFIX + addr + '-' + tsr + '-' + txid + '-' + o.n,
        value: sat,
      });
    } else {
      logger.info('Skipping output (non-standard or missing data):', {
        index: ii,
        scriptPubKey: o.scriptPubKey ? {
          type: o.scriptPubKey.type,
          addressCount: o.scriptPubKey.addresses ? o.scriptPubKey.addresses.length : 0,
          address: o.scriptPubKey.address,
          hex: o.scriptPubKey.hex
        } : null
      });
      
      // Only terminate if it's not a nulldata (OP_RETURN) output
      if (o.scriptPubKey && o.scriptPubKey.type !== 'nulldata') {
        console.error('Terminating due to skipped non-nulldata output');
        process.exit(1);
      }
    }
  }
  logger.info('Generated database script:', {
    txid: txid,
    operationCount: dbScript.length
  });
  return dbScript;
};



TransactionDb.prototype._addScriptYYY = function(tx, relatedAddrs) {
  var dbScript = [];
  var ts = tx.time;
  var txid = tx.txid || tx.hash;
  logger.info('Processing transaction for storage:', {
    txid: txid,
    time: ts,
    vinLength: tx.vin ? tx.vin.length : 0,
    voutLength: tx.vout ? tx.vout.length : 0
  });
  // Input Outpoints (mark them as spent)
  for (var ii in tx.vin) {
    var i = tx.vin[ii];
    if (i.txid) {
      var k = SPENT_PREFIX + i.txid + '-' + i.vout + '-' + txid + '-' + i.n;
      dbScript.push({
        type: 'put',
        key: k,
        value: ts || 0,
      });
      logger.info('Adding spent info:', {
        key: k,
        value: ts || 0
      });
    } else {
      logger.info('Input has no txid (likely coinbase):', {
        input: i,
        index: ii
      });
    }
  }

  for (var ii in tx.vout) {
    var o = tx.vout[ii];
    logger.info('Processing output:', {
      index: ii,
      hasScriptPubKey: !!o.scriptPubKey,
      hasAddresses: !!(o.scriptPubKey && o.scriptPubKey.addresses),
      hasAddress: !!(o.scriptPubKey && o.scriptPubKey.address),
      value: o.value,
      valueSat: o.valueSat,
      type: o.scriptPubKey ? o.scriptPubKey.type : null
    });

    var hasValidAddr = o.scriptPubKey && 
                      (o.scriptPubKey.address || 
                       (o.scriptPubKey.addresses && 
                        o.scriptPubKey.addresses[0] && 
                        !o.scriptPubKey.addresses[1]));

    if (hasValidAddr) {
      var addr = o.scriptPubKey.address || o.scriptPubKey.addresses[0];
      var sat = o.valueSat || ((o.value || 0) * util.COIN).toFixed(0);
      
      if (relatedAddrs) relatedAddrs[addr] = 1;
      var k = OUTS_PREFIX + txid + '-' + o.n;
      var tsr = END_OF_WORLD_TS - ts;
      
      logger.info('Storing output:', {
        key: k,
        value: addr + ':' + sat,
        address: addr,
        satoshis: sat,
        timestamp: ts,
        timestampReverse: tsr
      });
      
      dbScript.push({
        type: 'put',
        key: k,
        value: addr + ':' + sat,
      }, {
        type: 'put',
        key: ADDR_PREFIX + addr + '-' + tsr + '-' + txid + '-' + o.n,
        value: sat,
      });
    } else {
      logger.info('Skipping output (non-standard or missing data):', {
        index: ii,
        scriptPubKey: o.scriptPubKey ? {
          type: o.scriptPubKey.type,
          addressCount: o.scriptPubKey.addresses ? o.scriptPubKey.addresses.length : 0,
          address: o.scriptPubKey.address,
          hex: o.scriptPubKey.hex
        } : null
      });
      process.exit(1);
    }
  }
  logger.info('Generated database script:', {
    txid: txid,
    operationCount: dbScript.length
  });
  return dbScript;
};



TransactionDb.prototype._addScriptYY = function(tx, relatedAddrs) {
  var dbScript = [];
  var ts = tx.time;
  var txid = tx.txid || tx.hash;

  //logger.info('Processing transaction for storage:', {
  //  txid: txid,
  //  time: ts,
  //  vinLength: tx.vin ? tx.vin.length : 0,
  //  voutLength: tx.vout ? tx.vout.length : 0
  //});

  // Input Outpoints (mark them as spent)
  for (var ii in tx.vin) {
    var i = tx.vin[ii];
    if (i.txid) {
      var k = SPENT_PREFIX + i.txid + '-' + i.vout + '-' + txid + '-' + i.n;
      dbScript.push({
        type: 'put',
        key: k,
        value: ts || 0,
      });
      logger.info('Adding spent info:', {
        key: k,
        value: ts || 0
      });
    } else {
      logger.info('Input has no txid (likely coinbase):', {
        input: i,
        index: ii
      });
    }
  }

  for (var ii in tx.vout) {
    var o = tx.vout[ii];
    //logger.info('Processing output:', {
    //  index: ii,
    //  hasScriptPubKey: !!o.scriptPubKey,
    //  hasAddresses: !!(o.scriptPubKey && o.scriptPubKey.addresses),
    //  value: o.value,
    //  valueSat: o.valueSat
    //});

    if (o.scriptPubKey && o.scriptPubKey.addresses &&
      o.scriptPubKey.addresses[0] && !o.scriptPubKey.addresses[1]) {
      var addr = o.scriptPubKey.addresses[0];
      var sat = o.valueSat || ((o.value || 0) * util.COIN).toFixed(0);

      if (relatedAddrs) relatedAddrs[addr] = 1;
      var k = OUTS_PREFIX + txid + '-' + o.n;
      var tsr = END_OF_WORLD_TS - ts;

      //logger.info('Storing output:', {
      //  key: k,
      //  value: addr + ':' + sat,
      //  address: addr,
      //  satoshis: sat,
      //  timestamp: ts,
      //  timestampReverse: tsr
      //});

      dbScript.push({
        type: 'put',
        key: k,
        value: addr + ':' + sat,
      }, {
        type: 'put',
        key: ADDR_PREFIX + addr + '-' + tsr + '-' + txid + '-' + o.n,
        value: sat,
      });
    } else {
      logger.info('Skipping output (non-standard or missing data):', {
        index: ii,
        scriptPubKey: o.scriptPubKey ? {
          type: o.scriptPubKey.type,
          addressCount: o.scriptPubKey.addresses ? o.scriptPubKey.addresses.length : 0
        } : null
      });
    }
  }

  logger.info('Generated database script:', {
    txid: txid,
    operationCount: dbScript.length
  });

  return dbScript;
};

// relatedAddrs is an optional hash, to collect related addresses in the transaction 
TransactionDb.prototype._addScriptx = function(tx, relatedAddrs) {
  var dbScript = [];
  var ts = tx.time;
  var txid = tx.txid || tx.hash;
  // var u=require('util');
  // console.log('[TransactionDb.js.518]', u.inspect(tx,{depth:10})); //TODO
  // Input Outpoints (mark them as spent)
  for (var ii in tx.vin) {
    var i = tx.vin[ii];
    if (i.txid) {
      var k = SPENT_PREFIX + i.txid + '-' + i.vout + '-' + txid + '-' + i.n;
      dbScript.push({
        type: 'put',
        key: k,
        value: ts || 0,
      });
    }
  }

  for (var ii in tx.vout) {
    var o = tx.vout[ii];
    if (o.scriptPubKey && o.scriptPubKey.addresses &&
      o.scriptPubKey.addresses[0] && !o.scriptPubKey.addresses[1] // TODO : not supported=> standard multisig
    ) {
      var addr = o.scriptPubKey.addresses[0];
      var sat = o.valueSat || ((o.value || 0) * util.COIN).toFixed(0);

      if (relatedAddrs) relatedAddrs[addr] = 1;
      var k = OUTS_PREFIX + txid + '-' + o.n;
      var tsr = END_OF_WORLD_TS - ts;
      dbScript.push({
        type: 'put',
        key: k,
        value: addr + ':' + sat,
      }, {
        type: 'put',
        key: ADDR_PREFIX + addr + '-' + tsr + '-' + txid + '-' + o.n,
        value: sat,
      });
    }
  }
  return dbScript;
};

// adds an unconfimed TX
TransactionDb.prototype.add = function(tx, cb) {
  var relatedAddrs = {};
  var dbScript = this._addScript(tx, relatedAddrs);
  db.batch(dbScript, function(err) {
    return cb(err, relatedAddrs);
  });
};

TransactionDb.prototype._addManyFromObjs = function(txs, next) {
  var dbScript = [];
  for (var ii in txs) {
    var s = this._addScript(txs[ii]);
    dbScript = dbScript.concat(s);
  }
  db.batch(dbScript, next);
};

TransactionDb.prototype._addManyFromHashes = function(txs, next) {
  var self = this;
  var dbScript = [];
  async.eachLimit(txs, CONCURRENCY, function(tx, each_cb) {
      if (tx === genesisTXID)
        return each_cb();

      Rpc.getTxInfo(tx, function(err, inInfo) {
        if (!inInfo) return each_cb(err);
        dbScript = dbScript.concat(self._addScript(inInfo));
        return each_cb();
      });
    },
    function(err) {
      if (err) return next(err);
      db.batch(dbScript, next);
    });
};


TransactionDb.prototype.addMany = function(txs, next) {
  if (!txs) return next();

  var fn = (typeof txs[0] === 'string') ?
    this._addManyFromHashes : this._addManyFromObjs;

  return fn.apply(this, [txs, next]);
};


TransactionDb.prototype.getPoolInfo = function(txid, cb) {
  var self = this;
  Rpc.getTxInfo(txid, function(err, txInfo) {
    if (err) return cb(false);
    var ret;
    if (txInfo && txInfo.vout && txInfo.vout[0] && txInfo.vout[0].scriptPubKey) {
      var scriptPubKey = txInfo.vout[0].scriptPubKey;
      console.log('Full scriptPubKey:', scriptPubKey);

      var coinbase_address = scriptPubKey.address;
      if (coinbase_address) {
        console.log('Found coinbase address:', coinbase_address);
        ret = self.poolMatch.match(coinbase_address);
        console.log('Pool match result:', ret);

      }
    }

    return cb(ret);
  });
};


TransactionDb.prototype.checkVersion02 = function(cb) {
  var k = 'txa-';
  var isV2 = 1;
  db.createReadStream({
    start: k,
    end: k + '~',
    limit: 1,
  })
    .on('data', function(data) {
      isV2 = 0;
    })
    .on('end', function() {
      return cb(isV2);
    });
};

TransactionDb.prototype.migrateV02 = function(cb) {
  var k = 'txa-';
  var dbScript = [];
  var c = 0;
  var c2 = 0;
  var N = 50000;
  db.createReadStream({
    start: k,
    end: k + '~'
  })
    .on('data', function(data) {
      var k = data.key.split('-');
      var v = data.value.split(':');
      dbScript.push({
        type: 'put',
        key: ADDR_PREFIX + k[1] + '-' + (END_OF_WORLD_TS - parseInt(v[1])) + '-' + k[2] + '-' + k[3],
        value: v[0],
      });
      if (c++ > N) {
        console.log('\t%dM txs outs processed', ((c2 += N) / 1e6).toFixed(3)); //TODO
        db.batch(dbScript, function() {
          c = 0;
          dbScript = [];
        });
      }
    })
    .on('error', function(err) {
      return cb(err);
    })
    .on('end', function() {
      return cb();
    });
};



module.exports = require('soop')(TransactionDb);

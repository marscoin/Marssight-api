'use strict';

var imports = require('soop').imports();
var async = require('async');
var bitcore = require('Litecore');
var BitcoreAddress = bitcore.Address;
var BitcoreTransaction = bitcore.Transaction;
var BitcoreUtil = bitcore.util;
var Parser = bitcore.BinaryParser;
var Buffer = bitcore.Buffer;
var TransactionDb = imports.TransactionDb || require('../../lib/TransactionDb').default();
var BlockDb = imports.BlockDb || require('../../lib/BlockDb').default();
var config = require('../../config/config');
var CONCURRENCY = 5;

function Address(addrStr) {
  this.balanceSat = 0;
  this.totalReceivedSat = 0;
  this.totalSentSat = 0;

  this.unconfirmedBalanceSat = 0;

  this.txApperances = 0;
  this.unconfirmedTxApperances = 0;
  this.seen = {};

  // TODO store only txids? +index? +all?
  this.transactions = [];
  this.unspent = [];

  var a = new BitcoreAddress(addrStr);
  a.validate();
  this.addrStr = addrStr;

  Object.defineProperty(this, 'totalSent', {
    get: function() {
      return parseFloat(this.totalSentSat) / parseFloat(BitcoreUtil.COIN);
    },
    set: function(i) {
      this.totalSentSat = i * BitcoreUtil.COIN;
    },
    enumerable: 1,
  });

  Object.defineProperty(this, 'balance', {
    get: function() {
      return parseFloat(this.balanceSat) / parseFloat(BitcoreUtil.COIN);
    },
    set: function(i) {
      this.balance = i * BitcoreUtil.COIN;
    },
    enumerable: 1,
  });

  Object.defineProperty(this, 'totalReceived', {
    get: function() {
      return parseFloat(this.totalReceivedSat) / parseFloat(BitcoreUtil.COIN);
    },
    set: function(i) {
      this.totalReceived = i * BitcoreUtil.COIN;
    },
    enumerable: 1,
  });


  Object.defineProperty(this, 'unconfirmedBalance', {
    get: function() {
      return parseFloat(this.unconfirmedBalanceSat) / parseFloat(BitcoreUtil.COIN);
    },
    set: function(i) {
      this.unconfirmedBalanceSat = i * BitcoreUtil.COIN;
    },
    enumerable: 1,
  });

}

Address.prototype.getObj = function() {
  // Normalize json address
  return {
    'addrStr': this.addrStr,
    'balance': this.balance,
    'balanceSat': this.balanceSat,
    'totalReceived': this.totalReceived,
    'totalReceivedSat': this.totalReceivedSat,
    'totalSent': this.totalSent,
    'totalSentSat': this.totalSentSat,
    'unconfirmedBalance': this.unconfirmedBalance,
    'unconfirmedBalanceSat': this.unconfirmedBalanceSat,
    'unconfirmedTxApperances': this.unconfirmedTxApperances,
    'txApperances': this.txApperances,
    'transactions': this.transactions
  };
};

Address.prototype._addTxItem = function(txItem, txList, includeInfo) {
  function addTx(data) {
    if (!txList) return;
    if (includeInfo) {
      txList.push(data);
    } else {
      txList.push(data.txid);
    }
  };

  var add = 0,
    addSpend = 0;
  var v = txItem.value_sat;
  var seen = this.seen;

  // Founding tx
  if (!seen[txItem.txid]) {
    seen[txItem.txid] = 1;
    add = 1;

    addTx({
      txid: txItem.txid,
      ts: txItem.ts
    });
  }

  // Spent tx
  if (txItem.spentTxId && !seen[txItem.spentTxId]) {
    addTx({
      txid: txItem.spentTxId,
      ts: txItem.spentTs
    });
    seen[txItem.spentTxId] = 1;
    addSpend = 1;
  }

  // Use confirmations from RPC if available
  var isConfirmed = txItem.isConfirmed || (txItem.confirmations && txItem.confirmations > 0);
  var spentIsConfirmed = txItem.spentIsConfirmed || (txItem.spentConfirmations && txItem.spentConfirmations > 0);

  // Key fix: If this transaction is spent, and both the transaction and the spending transaction are confirmed,
  // this should count as a spent transaction (not unconfirmed negative balance)
  if (isConfirmed) {
    this.txApperances += add;
    this.totalReceivedSat += v;

    if (!txItem.spentTxId) {
      // Unspent confirmed transaction
      this.balanceSat += v;
    } else if (spentIsConfirmed) {
      // Both the transaction and the spending transaction are confirmed
      this.totalSentSat += v;
      this.txApperances += addSpend;
    } else {
      // Transaction is confirmed but spending is not
      this.balanceSat += v;
    }
  } else {
    // Unconfirmed transaction
    this.unconfirmedBalanceSat += v;
    this.unconfirmedTxApperances += add;
  }
};

Address.prototype._addTxItem3 = function(txItem, txList, includeInfo) {
  function addTx(data) {
    if (!txList) return;
    if (includeInfo) {
      txList.push(data);
    } else {
      txList.push(data.txid);
    }
  };

  var add = 0,
    addSpend = 0;
  var v = txItem.value_sat;
  var seen = this.seen;

  // Founding tx
  if (!seen[txItem.txid]) {
    seen[txItem.txid] = 1;
    add = 1;

    addTx({
      txid: txItem.txid,
      ts: txItem.ts
    });
  }

  // Spent tx
  if (txItem.spentTxId && !seen[txItem.spentTxId]) {
    addTx({
      txid: txItem.spentTxId,
      ts: txItem.spentTs
    });
    seen[txItem.spentTxId] = 1;
    addSpend = 1;
  }

  // Use confirmations from RPC if available
  var isConfirmed = txItem.isConfirmed || (txItem.confirmations && txItem.confirmations > 0);

  if (isConfirmed) {
    this.txApperances += add;
    this.totalReceivedSat += v;
    if (!txItem.spentTxId) {
      //unspent
      this.balanceSat += v;
    } else if (!txItem.spentIsConfirmed) {
      // unspent
      this.balanceSat += v;
      this.unconfirmedBalanceSat -= v;
      this.unconfirmedTxApperances += addSpend;
    } else {
      // spent
      this.totalSentSat += v;
      this.txApperances += addSpend;
    }
  } else {
    this.unconfirmedBalanceSat += v;
    this.unconfirmedTxApperances += add;
  }
};


Address.prototype._addTxItem2 = function(txItem, txList, includeInfo) {
  function addTx(data) {
    if (!txList) return;
    if (includeInfo) {
      txList.push(data);
    } else {
      txList.push(data.txid);
    }
  };

  var add = 0,
    addSpend = 0;
  var v = txItem.value_sat;
  var seen = this.seen;

  // Founding tx
  if (!seen[txItem.txid]) {
    seen[txItem.txid] = 1;
    add = 1;

    addTx({
      txid: txItem.txid,
      ts: txItem.ts
    });
  }

  // Spent tx
  if (txItem.spentTxId && !seen[txItem.spentTxId]) {
    addTx({
      txid: txItem.spentTxId,
      ts: txItem.spentTs
    });
    seen[txItem.spentTxId] = 1;
    addSpend = 1;
  }
  if (txItem.isConfirmed) {
    this.txApperances += add;
    this.totalReceivedSat += v;
    if (!txItem.spentTxId) {
      //unspent
      this.balanceSat += v;
    } else if (!txItem.spentIsConfirmed) {
      // unspent
      this.balanceSat += v;
      this.unconfirmedBalanceSat -= v;
      this.unconfirmedTxApperances += addSpend;
    } else {
      // spent
      this.totalSentSat += v;
      this.txApperances += addSpend;
    }
  } else {
    this.unconfirmedBalanceSat += v;
    this.unconfirmedTxApperances += add;
  }
};


Address.prototype.update = function(next, opts) {
  var self = this;
  if (!self.addrStr) return next();
  opts = opts || {};
  if (!('ignoreCache' in opts))
    opts.ignoreCache = config.ignoreCache;
  // should collect txList from address?
  var txList = opts.txLimit === 0 ? null : [];
  var tDb = TransactionDb;
  var bDb = BlockDb;
  tDb.fromAddr(self.addrStr, opts, function(err, txOut) {
    if (err) return next(err);
    
    // First, check for unconfirmed incoming transactions with RPC
    async.eachLimit(txOut.filter(function(tx) {
      return !tx.isConfirmed; // Only check unconfirmed transactions
    }), CONCURRENCY, function(tx, ecb) {
      // Use RPC to verify confirmation status
      var Rpc = require('../../lib/Rpc');
      Rpc.getTxInfo(tx.txid, function(rpcErr, txInfo) {
        if (!rpcErr && txInfo && txInfo.confirmations && txInfo.confirmations > 0) {
          // Update confirmation status
          tx.isConfirmed = true;
          tx.confirmations = txInfo.confirmations;
          console.log('RPC verification corrected transaction status: ' + tx.txid +
                     ' is confirmed with ' + tx.confirmations + ' confirmations');
        }
        ecb();
      });
    }, function(err) {
      if (err) console.error("Error verifying transaction confirmations:", err);
      
      // Second, check confirmation status of spending transactions
      async.eachLimit(txOut.filter(function(tx) {
        return tx.spentTxId && !tx.spentIsConfirmed; // Only check spending transactions that aren't marked confirmed
      }), CONCURRENCY, function(tx, ecb) {
        var Rpc = require('../../lib/Rpc');
        Rpc.getTxInfo(tx.spentTxId, function(rpcErr, txInfo) {
          if (!rpcErr && txInfo && txInfo.confirmations && txInfo.confirmations > 0) {
            // Update spending confirmation status
            tx.spentIsConfirmed = true;
            tx.spentConfirmations = txInfo.confirmations;
            console.log('RPC verification: spending tx ' + tx.spentTxId + 
                       ' is confirmed with ' + tx.spentConfirmations + ' confirmations');
          }
          ecb();
        });
      }, function(err) {
        if (err) console.error("Error verifying spending confirmations:", err);
        
        // Continue with the standard flow
        bDb.fillConfirmations(txOut, function(err) {
          if (err) return next(err);
          tDb.cacheConfirmations(txOut, function(err) {
            if (err) return next(err);
            if (opts.onlyUnspent) {
              txOut = txOut.filter(function(x) {
                return !x.spentTxId;
              });
              tDb.fillScriptPubKey(txOut, function() {
                self.unspent = txOut.map(function(x) {
                  return {
                    address: self.addrStr,
                    txid: x.txid,
                    vout: x.index,
                    ts: x.ts,
                    scriptPubKey: x.scriptPubKey,
                    amount: x.value_sat / BitcoreUtil.COIN,
                    confirmations: x.isConfirmed ? (x.confirmations || config.safeConfirmations) : 0,
                    confirmationsFromCache: !!x.isConfirmedCached,
                  };
                });
                return next();
              });
            } else {
              // Reset balance counters before recalculating
              self.balanceSat = 0;
              self.totalReceivedSat = 0;
              self.totalSentSat = 0;
              self.unconfirmedBalanceSat = 0;
              self.txApperances = 0;
              self.unconfirmedTxApperances = 0;
              self.seen = {};
              
              txOut.forEach(function(txItem) {
                self._addTxItem(txItem, txList, opts.includeTxInfo);
              });
              
              if (txList)
                self.transactions = txList;
              
              return next();
            }
          });
        });
      });
    });
  });
};


Address.prototype.update3 = function(next, opts) {
  var self = this;
  if (!self.addrStr) return next();
  opts = opts || {};

  if (!('ignoreCache' in opts))
    opts.ignoreCache = config.ignoreCache;

  // should collect txList from address?
  var txList = opts.txLimit === 0 ? null : [];

  var tDb = TransactionDb;
  var bDb = BlockDb;
  tDb.fromAddr(self.addrStr, opts, function(err, txOut) {
    if (err) return next(err);

    // Add this: check for unconfirmed transactions with RPC
    async.eachLimit(txOut.filter(function(tx) {
      return !tx.isConfirmed; // Only check unconfirmed transactions
    }), CONCURRENCY, function(tx, ecb) {
      // Use RPC to verify confirmation status
      var Rpc = require('../../lib/Rpc');
      Rpc.getTxInfo(tx.txid, function(rpcErr, txInfo) {
        if (!rpcErr && txInfo && txInfo.confirmations && txInfo.confirmations > 0) {
          // Update confirmation status
          tx.isConfirmed = true;
          tx.confirmations = txInfo.confirmations;
          console.log('RPC verification corrected transaction status: ' + tx.txid +
                     ' is confirmed with ' + tx.confirmations + ' confirmations');
        }
        ecb();
      });
    }, function(err) {
      if (err) console.error("Error verifying transaction confirmations:", err);

      // Continue with the standard flow
      bDb.fillConfirmations(txOut, function(err) {
        if (err) return next(err);

        tDb.cacheConfirmations(txOut, function(err) {
          if (err) return next(err);
          if (opts.onlyUnspent) {
            txOut = txOut.filter(function(x) {
              return !x.spentTxId;
            });
            tDb.fillScriptPubKey(txOut, function() {
              self.unspent = txOut.map(function(x) {
                return {
                  address: self.addrStr,
                  txid: x.txid,
                  vout: x.index,
                  ts: x.ts,
                  scriptPubKey: x.scriptPubKey,
                  amount: x.value_sat / BitcoreUtil.COIN,
                  confirmations: x.isConfirmed ? (x.confirmations || config.safeConfirmations) : 0,
                  confirmationsFromCache: !!x.isConfirmedCached,
                };
              });
              return next();
            });
          } else {
            // Reset balance counters before recalculating
            self.balanceSat = 0;
            self.totalReceivedSat = 0;
            self.totalSentSat = 0;
            self.unconfirmedBalanceSat = 0;
            self.txApperances = 0;
            self.unconfirmedTxApperances = 0;
            self.seen = {};

            txOut.forEach(function(txItem) {
              self._addTxItem(txItem, txList, opts.includeTxInfo);
            });
            if (txList)
              self.transactions = txList;

            return next();
          }
        });
      });
    });
  });
};

// opts are
// .onlyUnspent
// .txLimit     (=0 -> no txs, => -1 no limit)
// .includeTxInfo
// 
Address.prototype.update2 = function(next, opts) {
  var self = this;
  if (!self.addrStr) return next();
  opts = opts || {};

  if (!('ignoreCache' in opts))
    opts.ignoreCache = config.ignoreCache;

  // should collect txList from address?
  var txList = opts.txLimit === 0 ? null : [];

  var tDb = TransactionDb;
  var bDb = BlockDb;
  tDb.fromAddr(self.addrStr, opts, function(err, txOut) {
    if (err) return next(err);

    bDb.fillConfirmations(txOut, function(err) {
      if (err) return next(err);

      tDb.cacheConfirmations(txOut, function(err) {
        // console.log('[Address.js.161:txOut:]',txOut); //TODO
        if (err) return next(err);
        if (opts.onlyUnspent) {
          txOut = txOut.filter(function(x) {
            return !x.spentTxId;
          });
          tDb.fillScriptPubKey(txOut, function() {
            self.unspent = txOut.map(function(x) {
              return {
                address: self.addrStr,
                txid: x.txid,
                vout: x.index,
                ts: x.ts,
                scriptPubKey: x.scriptPubKey,
                amount: x.value_sat / BitcoreUtil.COIN,
                confirmations: x.isConfirmedCached ? (config.safeConfirmations) : x.confirmations,
                confirmationsFromCache: !!x.isConfirmedCached,
              };
            });
            return next();
          });
        } else {
          txOut.forEach(function(txItem) {
            self._addTxItem(txItem, txList, opts.includeTxInfo);
          });
          if (txList)
            self.transactions = txList;

          return next();
        }
      });
    });
  });
};

module.exports = require('soop')(Address);

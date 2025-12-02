'use strict';

/**
 * MockRpcClient - A mock implementation of the Litecore RpcClient
 *
 * This mock allows tests to run without a real Marscoin daemon connection.
 * It can be configured to return specific responses or errors for testing.
 *
 * Usage with soop:
 *   var Rpc = require('soop').load('./lib/Rpc', {
 *     bitcoreRpc: new MockRpcClient()
 *   });
 */

var fixtures = require('../fixtures/rpc-responses.json');

function MockRpcClient(config) {
  this.host = config && config.host || '127.0.0.1';
  this.port = config && config.port || 9981;
  this.user = config && config.user || 'testuser';
  this.pass = config && config.pass || 'testpass';

  // Storage for programmed responses
  this._responses = {
    transactions: {},
    blocks: {},
    blockHashes: {}
  };

  // Storage for tracking calls (for verification in tests)
  this._calls = {
    getRawTransaction: [],
    getBlock: [],
    getBlockHash: [],
    sendRawTransaction: [],
    verifyMessage: []
  };

  // Flag to simulate errors
  this._shouldError = false;
  this._errorToThrow = null;

  // Load default fixtures
  this._loadDefaultFixtures();
}

/**
 * Load default test fixtures
 */
MockRpcClient.prototype._loadDefaultFixtures = function() {
  var self = this;

  // Load transaction fixtures
  if (fixtures.transactions) {
    Object.keys(fixtures.transactions).forEach(function(key) {
      var tx = fixtures.transactions[key];
      if (tx.txid) {
        self._responses.transactions[tx.txid] = tx;
      }
    });
  }

  // Load block fixtures
  if (fixtures.blocks) {
    Object.keys(fixtures.blocks).forEach(function(key) {
      var block = fixtures.blocks[key];
      if (block.hash) {
        self._responses.blocks[block.hash] = block;
        if (block.height !== undefined) {
          self._responses.blockHashes[block.height] = block.hash;
        }
      }
    });
  }
};

/**
 * Program a specific transaction response
 */
MockRpcClient.prototype.setTransaction = function(txid, txData) {
  this._responses.transactions[txid] = txData;
};

/**
 * Program a specific block response
 */
MockRpcClient.prototype.setBlock = function(hash, blockData) {
  this._responses.blocks[hash] = blockData;
  if (blockData.height !== undefined) {
    this._responses.blockHashes[blockData.height] = hash;
  }
};

/**
 * Configure the mock to return an error on the next call
 */
MockRpcClient.prototype.setError = function(error) {
  this._shouldError = true;
  this._errorToThrow = error;
};

/**
 * Clear any programmed error
 */
MockRpcClient.prototype.clearError = function() {
  this._shouldError = false;
  this._errorToThrow = null;
};

/**
 * Reset all call tracking
 */
MockRpcClient.prototype.resetCalls = function() {
  Object.keys(this._calls).forEach(function(key) {
    this._calls[key] = [];
  }, this);
};

/**
 * Get the number of times a method was called
 */
MockRpcClient.prototype.getCallCount = function(method) {
  return this._calls[method] ? this._calls[method].length : 0;
};

/**
 * Get the arguments from a specific call
 */
MockRpcClient.prototype.getCallArgs = function(method, callIndex) {
  if (!this._calls[method]) return null;
  return this._calls[method][callIndex || 0];
};

// ============================================
// RPC Method Implementations
// ============================================

/**
 * getRawTransaction - Get transaction details
 * @param {string} txid - Transaction ID
 * @param {number} verbose - If 1, return decoded transaction
 * @param {function} callback - Callback(error, result)
 */
MockRpcClient.prototype.getRawTransaction = function(txid, verbose, callback) {
  var self = this;

  // Track the call
  this._calls.getRawTransaction.push({
    txid: txid,
    verbose: verbose
  });

  // Simulate async behavior
  setImmediate(function() {
    // Check for programmed error
    if (self._shouldError) {
      self._shouldError = false; // Reset for next call
      return callback(self._errorToThrow);
    }

    // Look up the transaction
    var tx = self._responses.transactions[txid];

    if (!tx) {
      // Transaction not found - return error code -5
      return callback({
        code: -5,
        message: 'No such mempool or blockchain transaction'
      });
    }

    // Return the transaction wrapped in result object (like real RPC)
    return callback(null, { result: tx });
  });
};

/**
 * getBlock - Get block details
 * @param {string} hash - Block hash
 * @param {function} callback - Callback(error, result)
 */
MockRpcClient.prototype.getBlock = function(hash, callback) {
  var self = this;

  // Track the call
  this._calls.getBlock.push({
    hash: hash
  });

  // Simulate async behavior
  setImmediate(function() {
    // Check for programmed error
    if (self._shouldError) {
      self._shouldError = false;
      return callback(self._errorToThrow);
    }

    // Look up the block
    var block = self._responses.blocks[hash];

    if (!block) {
      // Block not found - return error code -5
      return callback({
        code: -5,
        message: 'Block not found'
      });
    }

    // Return the block wrapped in result object
    return callback(null, { result: block });
  });
};

/**
 * getBlockHash - Get block hash at height
 * @param {number} height - Block height
 * @param {function} callback - Callback(error, result)
 */
MockRpcClient.prototype.getBlockHash = function(height, callback) {
  var self = this;

  // Track the call
  this._calls.getBlockHash.push({
    height: height
  });

  // Simulate async behavior
  setImmediate(function() {
    // Check for programmed error
    if (self._shouldError) {
      self._shouldError = false;
      return callback(self._errorToThrow);
    }

    // Look up the block hash
    var hash = self._responses.blockHashes[height];

    if (!hash) {
      // Height not found
      return callback({
        code: -8,
        message: 'Block height out of range'
      });
    }

    // Return the hash wrapped in result object
    return callback(null, { result: hash });
  });
};

/**
 * sendRawTransaction - Broadcast a raw transaction
 * @param {string} rawtx - Raw transaction hex
 * @param {function} callback - Callback(error, result)
 */
MockRpcClient.prototype.sendRawTransaction = function(rawtx, callback) {
  var self = this;

  // Track the call
  this._calls.sendRawTransaction.push({
    rawtx: rawtx
  });

  // Simulate async behavior
  setImmediate(function() {
    // Check for programmed error
    if (self._shouldError) {
      self._shouldError = false;
      return callback(self._errorToThrow);
    }

    // Generate a fake txid (in real life this would be the hash of the tx)
    var fakeTxid = 'mock_txid_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);

    // Return the txid wrapped in result object
    return callback(null, { result: fakeTxid });
  });
};

/**
 * verifyMessage - Verify a signed message
 * @param {string} address - Marscoin address
 * @param {string} signature - Base64 signature
 * @param {string} message - The message that was signed
 * @param {function} callback - Callback(error, result)
 */
MockRpcClient.prototype.verifyMessage = function(address, signature, message, callback) {
  var self = this;

  // Track the call
  this._calls.verifyMessage.push({
    address: address,
    signature: signature,
    message: message
  });

  // Simulate async behavior
  setImmediate(function() {
    // Check for programmed error
    if (self._shouldError) {
      self._shouldError = false;
      return callback(self._errorToThrow);
    }

    // For testing, we can check for specific test signatures
    // In real tests, you'd program specific responses
    var isValid = signature === 'valid_signature';

    // Return the result wrapped in result object
    return callback(null, { result: isValid });
  });
};

module.exports = MockRpcClient;

'use strict';

/**
 * MockLitecore - A mock implementation of the Litecore (bitcore) library
 *
 * This mock provides the minimal interface needed by Rpc.js for testing:
 * - RpcClient: RPC interface (we use MockRpcClient instead)
 * - Block: Block parsing (minimal)
 * - util: Utility functions (COIN constant)
 */

// Constants matching the real bitcore/litecore
var COIN = 100000000; // Satoshis per coin

/**
 * Mock RpcClient - delegates to MockRpcClient
 * In real tests, we inject MockRpcClient via soop
 */
function MockRpcClient(config) {
  this.host = config.host || '127.0.0.1';
  this.port = config.port || 9981;
  this.user = config.user || '';
  this.pass = config.pass || '';
  this.protocol = config.protocol || 'http';
}

MockRpcClient.prototype.getRawTransaction = function(txid, verbose, cb) {
  cb(new Error('MockRpcClient: Use dependency injection to provide a real mock'));
};

MockRpcClient.prototype.getBlock = function(hash, cb) {
  cb(new Error('MockRpcClient: Use dependency injection to provide a real mock'));
};

MockRpcClient.prototype.getBlockHash = function(height, cb) {
  cb(new Error('MockRpcClient: Use dependency injection to provide a real mock'));
};

MockRpcClient.prototype.sendRawTransaction = function(rawtx, cb) {
  cb(new Error('MockRpcClient: Use dependency injection to provide a real mock'));
};

MockRpcClient.prototype.verifyMessage = function(address, sig, msg, cb) {
  cb(new Error('MockRpcClient: Use dependency injection to provide a real mock'));
};

/**
 * Mock Block class
 */
function MockBlock() {}

/**
 * Mock utility object
 */
var mockUtil = {
  COIN: COIN
};

/**
 * Mock networks
 */
var mockNetworks = {
  livenet: {
    name: 'livenet',
    addressVersion: 50, // Marscoin mainnet
    p2shVersion: 5
  },
  testnet: {
    name: 'testnet',
    addressVersion: 111,
    p2shVersion: 196
  }
};

// Export the mock module with the same interface as Litecore/bitcore
module.exports = {
  RpcClient: MockRpcClient,
  Block: MockBlock,
  util: mockUtil,
  networks: mockNetworks,
  COIN: COIN
};

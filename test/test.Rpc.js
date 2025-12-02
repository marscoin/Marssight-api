'use strict';

/**
 * Unit tests for lib/Rpc.js
 *
 * These tests verify the RPC interface layer that communicates with
 * the Marscoin daemon. Using mocks allows testing without a running daemon.
 */

var chai = require('chai');
var expect = chai.expect;
var should = chai.should();
var sinon = require('sinon');

var MockRpcClient = require('./mocks/MockRpcClient');
var fixtures = require('./fixtures/rpc-responses.json');

describe('Rpc', function() {
  var Rpc;
  var mockRpc;

  beforeEach(function() {
    // Create a fresh mock RPC client for each test
    mockRpc = new MockRpcClient();

    // Load Rpc module with the mock injected via soop
    Rpc = require('soop').load('../lib/Rpc', {
      bitcoreRpc: mockRpc
    });
  });

  afterEach(function() {
    mockRpc.resetCalls();
  });

  // ============================================
  // _parseTxResult Tests
  // ============================================
  describe('#_parseTxResult()', function() {
    it('should parse a coinbase transaction correctly', function() {
      // Create a copy of the fixture to avoid mutation
      var txInfo = JSON.parse(JSON.stringify(fixtures.transactions.coinbase));

      var result = Rpc._parseTxResult(txInfo);

      // Should have removed the hex field
      expect(result.hex).to.be.undefined;

      // Should have added index to vin
      expect(result.vin[0].n).to.equal(0);

      // Should have detected coinbase
      expect(result.isCoinBase).to.be.true;

      // Should have calculated valueOut
      expect(result.valueOut).to.equal(50);

      // Should have size
      expect(result.size).to.be.a('number');
      expect(result.size).to.be.greaterThan(0);
    });

    it('should parse a regular transaction correctly', function() {
      var txInfo = JSON.parse(JSON.stringify(fixtures.transactions.regular));

      var result = Rpc._parseTxResult(txInfo);

      // Should have removed hex
      expect(result.hex).to.be.undefined;

      // Should not be coinbase
      expect(result.isCoinBase).to.be.undefined;

      // Should have indexed vin
      expect(result.vin[0].n).to.equal(0);

      // Should calculate valueOut (sum of outputs)
      // 1.5 + 48.4999 = 49.9999
      expect(result.valueOut).to.be.closeTo(49.9999, 0.0001);
    });

    it('should handle multiple vins correctly', function() {
      var txInfo = {
        hex: 'deadbeef',
        vin: [
          { txid: 'tx1', vout: 0, scriptSig: {} },
          { txid: 'tx2', vout: 1, scriptSig: {} },
          { txid: 'tx3', vout: 2, scriptSig: {} }
        ],
        vout: [
          { value: 1.0, n: 0, scriptPubKey: { type: 'pubkeyhash' } }
        ]
      };

      var result = Rpc._parseTxResult(txInfo);

      // Each vin should have its index
      expect(result.vin[0].n).to.equal(0);
      expect(result.vin[1].n).to.equal(1);
      expect(result.vin[2].n).to.equal(2);
    });

    it('should format vout values to 8 decimal places', function() {
      var txInfo = {
        hex: 'deadbeef',
        vin: [{ coinbase: '04...', sequence: 4294967295 }],
        vout: [
          { value: 12.123456789, n: 0, scriptPubKey: { type: 'pubkeyhash' } }
        ]
      };

      var result = Rpc._parseTxResult(txInfo);

      // Value should be formatted as string with 8 decimals
      expect(result.vout[0].value).to.equal('12.12345679');
    });
  });

  // ============================================
  // errMsg Tests
  // ============================================
  describe('#errMsg()', function() {
    it('should enhance error message with connection details', function() {
      var originalError = new Error('Connection failed');

      var enhancedError = Rpc.errMsg(originalError);

      // Should contain host info
      expect(enhancedError.message).to.include('127.0.0.1');
      expect(enhancedError.message).to.include('9981');
      expect(enhancedError.message).to.include('testuser');
    });
  });

  // ============================================
  // getTxInfo Tests
  // ============================================
  describe('#getTxInfo()', function() {
    it('should return transaction info for existing txid', function(done) {
      var txid = fixtures.transactions.coinbase.txid;

      Rpc.getTxInfo(txid, function(err, info) {
        expect(err).to.be.null;
        expect(info).to.exist;
        expect(info.txid).to.equal(txid);
        expect(info.isCoinBase).to.be.true;

        // Verify mock was called
        expect(mockRpc.getCallCount('getRawTransaction')).to.equal(1);
        done();
      });
    });

    it('should return undefined for non-existent txid (error -5)', function(done) {
      var txid = 'nonexistent_txid_123';

      Rpc.getTxInfo(txid, function(err, info) {
        // Should not return error, just undefined
        expect(err).to.be.undefined;
        expect(info).to.be.undefined;
        done();
      });
    });

    it('should return error for undefined txid', function(done) {
      Rpc.getTxInfo(undefined, function(err, info) {
        expect(err).to.exist;
        expect(err.message).to.include('undefined');
        done();
      });
    });

    it('should pass through RPC errors (non -5)', function(done) {
      // Program an error
      mockRpc.setError({ code: -1, message: 'Connection refused' });

      Rpc.getTxInfo('any_txid', function(err, info) {
        expect(err).to.exist;
        expect(err.message).to.include('Connection refused');
        done();
      });
    });

    it('should return unparsed result when doNotParse is true', function(done) {
      var txid = fixtures.transactions.coinbase.txid;

      Rpc.getTxInfo(txid, true, function(err, info) {
        expect(err).to.be.null;
        expect(info).to.exist;
        // Should still have hex since we didn't parse
        expect(info.hex).to.exist;
        done();
      });
    });
  });

  // ============================================
  // blockIndex Tests
  // ============================================
  describe('#blockIndex()', function() {
    it('should return block hash for valid height', function(done) {
      var height = 71619;

      Rpc.blockIndex(height, function(err, result) {
        expect(err).to.be.null;
        expect(result).to.exist;
        expect(result.blockHash).to.equal(fixtures.blocks.sample.hash);
        done();
      });
    });

    it('should return error for invalid height', function(done) {
      var height = 999999999;

      Rpc.blockIndex(height, function(err, result) {
        expect(err).to.exist;
        done();
      });
    });
  });

  // ============================================
  // getBlock Tests
  // ============================================
  describe('#getBlock()', function() {
    it('should return block info for valid hash', function(done) {
      var hash = fixtures.blocks.sample.hash;

      Rpc.getBlock(hash, function(err, info) {
        expect(err).to.be.null;
        expect(info).to.exist;
        expect(info.hash).to.equal(hash);
        expect(info.height).to.equal(71619);
        expect(info.nonce).to.equal(3960980741);

        // Should have reward calculated
        expect(info.reward).to.exist;
        done();
      });
    });

    it('should return undefined for non-existent block', function(done) {
      var hash = 'nonexistent_block_hash';

      Rpc.getBlock(hash, function(err, info) {
        expect(err).to.be.undefined;
        expect(info).to.be.undefined;
        done();
      });
    });

    it('should pass through RPC errors', function(done) {
      mockRpc.setError({ code: -1, message: 'Network error' });

      Rpc.getBlock('any_hash', function(err, info) {
        expect(err).to.exist;
        expect(err.message).to.include('Network error');
        done();
      });
    });
  });

  // ============================================
  // _getBlockValue Tests
  // ============================================
  describe('#_getBlockValue()', function() {
    it('should return 50 MARS for blocks before first halving', function() {
      // With halvingBlocks = 150, blocks 0-149 should be 50 MARS
      var reward = Rpc._getBlockValue(0);
      expect(reward).to.equal(50 * 100000000); // 50 MARS in satoshis

      reward = Rpc._getBlockValue(149);
      expect(reward).to.equal(50 * 100000000);
    });

    it('should return 25 MARS after first halving', function() {
      // Blocks 150-299 should be 25 MARS
      var reward = Rpc._getBlockValue(150);
      expect(reward).to.equal(25 * 100000000);
    });

    it('should return 0 after 64 halvings', function() {
      // After 64 halvings, reward should be 0
      var reward = Rpc._getBlockValue(150 * 64);
      expect(reward).to.equal(0);
    });
  });

  // ============================================
  // sendRawTransaction Tests
  // ============================================
  describe('#sendRawTransaction()', function() {
    it('should broadcast transaction and return txid', function(done) {
      var rawtx = '0100000001abcd...';

      Rpc.sendRawTransaction(rawtx, function(err, txid) {
        expect(err).to.be.null;
        expect(txid).to.exist;
        expect(txid).to.be.a('string');

        // Verify mock was called with correct params
        var callArgs = mockRpc.getCallArgs('sendRawTransaction');
        expect(callArgs.rawtx).to.equal(rawtx);
        done();
      });
    });

    it('should return error for invalid transaction', function(done) {
      mockRpc.setError({ code: -25, message: 'Transaction rejected' });

      Rpc.sendRawTransaction('invalid_tx', function(err, txid) {
        expect(err).to.exist;
        expect(err.code).to.equal(-25);
        done();
      });
    });
  });

  // ============================================
  // verifyMessage Tests
  // ============================================
  describe('#verifyMessage()', function() {
    it('should return true for valid signature', function(done) {
      var address = 'MJvWsioZF1xXH2V4rGMjaNVtdkVxNRJwt2';
      var signature = 'valid_signature'; // Our mock recognizes this
      var message = 'Hello, Mars!';

      Rpc.verifyMessage(address, signature, message, function(err, isValid) {
        expect(err).to.be.null;
        expect(isValid).to.be.true;
        done();
      });
    });

    it('should return false for invalid signature', function(done) {
      var address = 'MJvWsioZF1xXH2V4rGMjaNVtdkVxNRJwt2';
      var signature = 'invalid_signature';
      var message = 'Hello, Mars!';

      Rpc.verifyMessage(address, signature, message, function(err, isValid) {
        expect(err).to.be.null;
        expect(isValid).to.be.false;
        done();
      });
    });

    it('should return error for malformed signature (code -3)', function(done) {
      mockRpc.setError({ code: -3, message: 'Invalid address' });

      Rpc.verifyMessage('bad_address', 'sig', 'msg', function(err, isValid) {
        expect(err).to.exist;
        expect(err.code).to.equal(-3);
        done();
      });
    });

    it('should return error for invalid address (code -5)', function(done) {
      mockRpc.setError({ code: -5, message: 'Malformed base64' });

      Rpc.verifyMessage('addr', 'bad_base64', 'msg', function(err, isValid) {
        expect(err).to.exist;
        expect(err.code).to.equal(-5);
        done();
      });
    });
  });

  // ============================================
  // Integration-style tests (mock still used)
  // ============================================
  describe('Mock RPC Client Verification', function() {
    it('should track all RPC calls', function(done) {
      var txid = fixtures.transactions.coinbase.txid;

      Rpc.getTxInfo(txid, function() {
        Rpc.getBlock(fixtures.blocks.sample.hash, function() {
          expect(mockRpc.getCallCount('getRawTransaction')).to.equal(1);
          expect(mockRpc.getCallCount('getBlock')).to.equal(1);
          done();
        });
      });
    });

    it('should allow programmatic response overrides', function(done) {
      // Program a custom transaction
      var customTx = {
        hex: 'cafe',
        txid: 'custom_tx_123',
        vin: [{ coinbase: 'test' }],
        vout: [{ value: 100.0, n: 0, scriptPubKey: { type: 'pubkey' } }]
      };
      mockRpc.setTransaction('custom_tx_123', customTx);

      Rpc.getTxInfo('custom_tx_123', function(err, info) {
        expect(err).to.be.null;
        expect(info).to.exist;
        expect(info.valueOut).to.equal(100);
        done();
      });
    });
  });
});

// ============================================
// Additional edge case tests
// ============================================
describe('Rpc Edge Cases', function() {
  var Rpc;
  var mockRpc;

  beforeEach(function() {
    mockRpc = new MockRpcClient();
    Rpc = require('soop').load('../lib/Rpc', {
      bitcoreRpc: mockRpc
    });
  });

  describe('Transaction parsing edge cases', function() {
    it('should handle empty vout array', function() {
      var txInfo = {
        hex: 'dead',
        vin: [{ coinbase: 'test' }],
        vout: []
      };

      var result = Rpc._parseTxResult(txInfo);
      expect(result.valueOut).to.equal(0);
    });

    it('should handle very small values correctly', function() {
      var txInfo = {
        hex: 'dead',
        vin: [{ txid: 'test', vout: 0 }],
        vout: [
          { value: 0.00000001, n: 0, scriptPubKey: { type: 'pubkeyhash' } }
        ]
      };

      var result = Rpc._parseTxResult(txInfo);
      expect(result.valueOut).to.be.closeTo(0.00000001, 0.000000001);
    });

    it('should handle very large values correctly', function() {
      var txInfo = {
        hex: 'dead',
        vin: [{ txid: 'test', vout: 0 }],
        vout: [
          { value: 21000000.0, n: 0, scriptPubKey: { type: 'pubkeyhash' } }
        ]
      };

      var result = Rpc._parseTxResult(txInfo);
      expect(result.valueOut).to.equal(21000000);
    });
  });
});

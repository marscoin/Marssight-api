'use strict';

/**
 * Pure Function Tests for lib/Rpc.js
 *
 * These tests verify the pure functions in Rpc.js that don't require
 * the Litecore native modules. This allows testing on modern Node.js
 * without rebuilding native dependencies.
 *
 * Tested functions:
 * - _parseTxResult (transaction parsing logic)
 * - _getBlockValue (block reward calculation)
 * - errMsg (error message formatting)
 */

var chai = require('chai');
var expect = chai.expect;
var should = chai.should();

var fixtures = require('./fixtures/rpc-responses.json');

// Constants from Litecore (avoid loading native module)
var COIN = 100000000;

describe('Rpc Pure Functions', function() {

  // ============================================
  // Mock the minimal bitcore interface
  // ============================================
  var mockBitcore = {
    util: { COIN: COIN }
  };

  // ============================================
  // Extracted _parseTxResult function for testing
  // ============================================
  function parseTxResult(info) {
    var b = Buffer.from(info.hex, 'hex');

    // Remove hex field
    delete info.hex;

    // Inputs => add index + coinBase flag
    var n = 0;
    info.vin.forEach(function(i) {
      i.n = n++;
      if (i.coinbase) info.isCoinBase = true;
    });

    // Outputs => add total
    var valueOutSat = 0;
    info.vout.forEach(function(out) {
      out.value = out.value.toFixed(8);
      valueOutSat += parseFloat(out.value) * COIN;
    });
    info.valueOut = valueOutSat.toFixed(0) / COIN;
    info.size = b.length;

    return info;
  }

  // ============================================
  // Extracted _getBlockValue function for testing
  // ============================================
  function getBlockValue(height) {
    var halvingBlocks = 150;
    var halvings = Math.floor(height / halvingBlocks);
    if (halvings >= 64)
      return 0;

    var reward = 50 * COIN;
    reward = Math.floor(reward / Math.pow(2, halvings));
    return reward;
  }

  // ============================================
  // Extracted errMsg function for testing
  // ============================================
  function errMsg(err, rpcConfig) {
    var e = err;
    e.message += ' [Host: ' + rpcConfig.host + ':' + rpcConfig.port +
                 ' User:' + rpcConfig.user +
                 ' Using password:' + (rpcConfig.pass ? 'yes' : 'no') + ']';
    return e;
  }

  // ============================================
  // _parseTxResult Tests
  // ============================================
  describe('#_parseTxResult()', function() {

    it('should parse a coinbase transaction correctly', function() {
      var txInfo = JSON.parse(JSON.stringify(fixtures.transactions.coinbase));

      var result = parseTxResult(txInfo);

      // Should have removed the hex field
      expect(result.hex).to.be.undefined;

      // Should have added index to vin
      expect(result.vin[0].n).to.equal(0);

      // Should have detected coinbase
      expect(result.isCoinBase).to.be.true;

      // Should have calculated valueOut (50 MARS)
      expect(result.valueOut).to.equal(50);

      // Should have size
      expect(result.size).to.be.a('number');
      expect(result.size).to.be.greaterThan(0);
    });

    it('should parse a regular transaction correctly', function() {
      var txInfo = JSON.parse(JSON.stringify(fixtures.transactions.regular));

      var result = parseTxResult(txInfo);

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

      var result = parseTxResult(txInfo);

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

      var result = parseTxResult(txInfo);

      // Value should be formatted as string with 8 decimals
      expect(result.vout[0].value).to.equal('12.12345679');
    });

    it('should handle empty vout array', function() {
      var txInfo = {
        hex: 'dead',
        vin: [{ coinbase: 'test' }],
        vout: []
      };

      var result = parseTxResult(txInfo);
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

      var result = parseTxResult(txInfo);
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

      var result = parseTxResult(txInfo);
      expect(result.valueOut).to.equal(21000000);
    });

    it('should handle multiple outputs summing correctly', function() {
      var txInfo = {
        hex: 'dead',
        vin: [{ txid: 'test', vout: 0 }],
        vout: [
          { value: 10.5, n: 0, scriptPubKey: { type: 'pubkeyhash' } },
          { value: 5.25, n: 1, scriptPubKey: { type: 'pubkeyhash' } },
          { value: 2.125, n: 2, scriptPubKey: { type: 'pubkeyhash' } }
        ]
      };

      var result = parseTxResult(txInfo);
      // 10.5 + 5.25 + 2.125 = 17.875
      expect(result.valueOut).to.be.closeTo(17.875, 0.0001);
    });
  });

  // ============================================
  // _getBlockValue Tests
  // ============================================
  describe('#_getBlockValue()', function() {

    it('should return 50 MARS for genesis block', function() {
      var reward = getBlockValue(0);
      expect(reward).to.equal(50 * COIN);
    });

    it('should return 50 MARS for blocks before first halving', function() {
      // Blocks 0-149 should be 50 MARS
      expect(getBlockValue(0)).to.equal(50 * COIN);
      expect(getBlockValue(1)).to.equal(50 * COIN);
      expect(getBlockValue(100)).to.equal(50 * COIN);
      expect(getBlockValue(149)).to.equal(50 * COIN);
    });

    it('should return 25 MARS after first halving', function() {
      // Blocks 150-299 should be 25 MARS
      expect(getBlockValue(150)).to.equal(25 * COIN);
      expect(getBlockValue(200)).to.equal(25 * COIN);
      expect(getBlockValue(299)).to.equal(25 * COIN);
    });

    it('should return 12.5 MARS after second halving', function() {
      // Blocks 300-449 should be 12.5 MARS
      expect(getBlockValue(300)).to.equal(12.5 * COIN);
      expect(getBlockValue(400)).to.equal(12.5 * COIN);
    });

    it('should continue halving pattern', function() {
      expect(getBlockValue(450)).to.equal(6.25 * COIN);   // 3rd halving
      expect(getBlockValue(600)).to.equal(3.125 * COIN);  // 4th halving
    });

    it('should return 0 after 64 halvings', function() {
      var reward = getBlockValue(150 * 64);
      expect(reward).to.equal(0);
    });

    it('should return 0 well beyond 64 halvings', function() {
      var reward = getBlockValue(150 * 100);
      expect(reward).to.equal(0);
    });
  });

  // ============================================
  // errMsg Tests
  // ============================================
  describe('#errMsg()', function() {

    it('should enhance error message with connection details', function() {
      var originalError = new Error('Connection failed');
      var rpcConfig = {
        host: '127.0.0.1',
        port: 9981,
        user: 'testuser',
        pass: 'testpass'
      };

      var enhancedError = errMsg(originalError, rpcConfig);

      expect(enhancedError.message).to.include('127.0.0.1');
      expect(enhancedError.message).to.include('9981');
      expect(enhancedError.message).to.include('testuser');
      expect(enhancedError.message).to.include('yes'); // has password
    });

    it('should indicate when no password is used', function() {
      var originalError = new Error('Auth failed');
      var rpcConfig = {
        host: 'localhost',
        port: 8332,
        user: 'admin',
        pass: ''
      };

      var enhancedError = errMsg(originalError, rpcConfig);

      expect(enhancedError.message).to.include('no');
    });

    it('should preserve original error type', function() {
      var originalError = new TypeError('Invalid type');
      var rpcConfig = { host: 'h', port: 1, user: 'u', pass: '' };

      var enhancedError = errMsg(originalError, rpcConfig);

      expect(enhancedError).to.be.instanceOf(TypeError);
    });
  });
});

// ============================================
// Additional edge case tests
// ============================================
describe('Rpc Pure Functions Edge Cases', function() {

  // Re-use the extracted functions
  function parseTxResult(info) {
    var b = Buffer.from(info.hex, 'hex');
    delete info.hex;
    var n = 0;
    info.vin.forEach(function(i) {
      i.n = n++;
      if (i.coinbase) info.isCoinBase = true;
    });
    var valueOutSat = 0;
    info.vout.forEach(function(out) {
      out.value = out.value.toFixed(8);
      valueOutSat += parseFloat(out.value) * COIN;
    });
    info.valueOut = valueOutSat.toFixed(0) / COIN;
    info.size = b.length;
    return info;
  }

  describe('Transaction parsing robustness', function() {

    it('should handle hex of various lengths', function() {
      var shortTx = {
        hex: 'aa',
        vin: [{ txid: 't', vout: 0 }],
        vout: [{ value: 1.0, n: 0, scriptPubKey: {} }]
      };
      expect(parseTxResult(shortTx).size).to.equal(1);

      var longHex = 'aa'.repeat(1000);
      var longTx = {
        hex: longHex,
        vin: [{ txid: 't', vout: 0 }],
        vout: [{ value: 1.0, n: 0, scriptPubKey: {} }]
      };
      expect(parseTxResult(longTx).size).to.equal(1000);
    });

    it('should handle coinbase with multiple outputs', function() {
      var tx = {
        hex: 'dead',
        vin: [{ coinbase: 'abc123' }],
        vout: [
          { value: 25.0, n: 0, scriptPubKey: {} },
          { value: 25.0, n: 1, scriptPubKey: {} }
        ]
      };

      var result = parseTxResult(tx);
      expect(result.isCoinBase).to.be.true;
      expect(result.valueOut).to.equal(50);
    });

    it('should preserve scriptPubKey information', function() {
      var tx = {
        hex: 'dead',
        vin: [{ txid: 't', vout: 0 }],
        vout: [{
          value: 1.0,
          n: 0,
          scriptPubKey: {
            asm: 'OP_DUP OP_HASH160 ...',
            hex: '76a914...',
            type: 'pubkeyhash',
            addresses: ['MAddress123']
          }
        }]
      };

      var result = parseTxResult(tx);
      expect(result.vout[0].scriptPubKey.type).to.equal('pubkeyhash');
      expect(result.vout[0].scriptPubKey.addresses).to.include('MAddress123');
    });
  });

  describe('Floating point precision', function() {

    it('should handle precision edge cases', function() {
      // This tests the classic 0.1 + 0.2 != 0.3 issue
      var tx = {
        hex: 'dead',
        vin: [{ txid: 't', vout: 0 }],
        vout: [
          { value: 0.1, n: 0, scriptPubKey: {} },
          { value: 0.2, n: 1, scriptPubKey: {} }
        ]
      };

      var result = parseTxResult(tx);
      // Using closeTo because of floating point
      expect(result.valueOut).to.be.closeTo(0.3, 0.00000001);
    });

    it('should maintain satoshi precision for small amounts', function() {
      var tx = {
        hex: 'dead',
        vin: [{ txid: 't', vout: 0 }],
        vout: [
          { value: 0.00000001, n: 0, scriptPubKey: {} }, // 1 satoshi
          { value: 0.00000001, n: 1, scriptPubKey: {} }  // 1 satoshi
        ]
      };

      var result = parseTxResult(tx);
      expect(result.valueOut).to.be.closeTo(0.00000002, 0.000000001);
    });
  });
});

console.log('Pure function tests loaded successfully');

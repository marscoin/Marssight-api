'use strict';

/**
 * Unit tests for lib/bufferUtils.js
 *
 * Tests the pure JavaScript buffer utilities that replace
 * the native buffertools module.
 */

var chai = require('chai');
var expect = chai.expect;
var bufferUtils = require('../lib/bufferUtils');

describe('bufferUtils', function() {

  describe('#reverse()', function() {

    it('should reverse a buffer in place', function() {
      var buf = Buffer.from([1, 2, 3, 4, 5]);
      var result = bufferUtils.reverse(buf);

      expect(result).to.equal(buf); // Same reference
      expect(buf[0]).to.equal(5);
      expect(buf[1]).to.equal(4);
      expect(buf[2]).to.equal(3);
      expect(buf[3]).to.equal(2);
      expect(buf[4]).to.equal(1);
    });

    it('should handle empty buffer', function() {
      var buf = Buffer.from([]);
      var result = bufferUtils.reverse(buf);

      expect(result.length).to.equal(0);
    });

    it('should handle single byte buffer', function() {
      var buf = Buffer.from([42]);
      var result = bufferUtils.reverse(buf);

      expect(result[0]).to.equal(42);
    });

    it('should handle even length buffer', function() {
      var buf = Buffer.from([1, 2, 3, 4]);
      bufferUtils.reverse(buf);

      expect(Array.from(buf)).to.deep.equal([4, 3, 2, 1]);
    });

    it('should handle odd length buffer', function() {
      var buf = Buffer.from([1, 2, 3, 4, 5]);
      bufferUtils.reverse(buf);

      expect(Array.from(buf)).to.deep.equal([5, 4, 3, 2, 1]);
    });

    it('should work with 32-byte hash (like txid)', function() {
      var hash = Buffer.alloc(32);
      for (var i = 0; i < 32; i++) {
        hash[i] = i;
      }

      bufferUtils.reverse(hash);

      expect(hash[0]).to.equal(31);
      expect(hash[31]).to.equal(0);
    });
  });

  describe('#reverseCopy()', function() {

    it('should return a new reversed buffer', function() {
      var buf = Buffer.from([1, 2, 3, 4, 5]);
      var result = bufferUtils.reverseCopy(buf);

      // Original unchanged
      expect(buf[0]).to.equal(1);
      expect(buf[4]).to.equal(5);

      // Result reversed
      expect(result[0]).to.equal(5);
      expect(result[4]).to.equal(1);

      // Different references
      expect(result).to.not.equal(buf);
    });
  });

  describe('#compare()', function() {

    it('should return 0 for equal buffers', function() {
      var a = Buffer.from([1, 2, 3]);
      var b = Buffer.from([1, 2, 3]);

      expect(bufferUtils.compare(a, b)).to.equal(0);
    });

    it('should return -1 when first buffer is less', function() {
      var a = Buffer.from([1, 2, 3]);
      var b = Buffer.from([1, 2, 4]);

      expect(bufferUtils.compare(a, b)).to.equal(-1);
    });

    it('should return 1 when first buffer is greater', function() {
      var a = Buffer.from([1, 2, 4]);
      var b = Buffer.from([1, 2, 3]);

      expect(bufferUtils.compare(a, b)).to.equal(1);
    });

    it('should compare by length when prefix matches', function() {
      var a = Buffer.from([1, 2]);
      var b = Buffer.from([1, 2, 3]);

      expect(bufferUtils.compare(a, b)).to.equal(-1);
    });
  });

  describe('#equals()', function() {

    it('should return true for equal buffers', function() {
      var a = Buffer.from([1, 2, 3]);
      var b = Buffer.from([1, 2, 3]);

      expect(bufferUtils.equals(a, b)).to.be.true;
    });

    it('should return false for different buffers', function() {
      var a = Buffer.from([1, 2, 3]);
      var b = Buffer.from([1, 2, 4]);

      expect(bufferUtils.equals(a, b)).to.be.false;
    });

    it('should return false for different lengths', function() {
      var a = Buffer.from([1, 2, 3]);
      var b = Buffer.from([1, 2, 3, 4]);

      expect(bufferUtils.equals(a, b)).to.be.false;
    });
  });

  describe('#concat()', function() {

    it('should concatenate multiple buffers', function() {
      var a = Buffer.from([1, 2]);
      var b = Buffer.from([3, 4]);
      var c = Buffer.from([5]);

      var result = bufferUtils.concat(a, b, c);

      expect(Array.from(result)).to.deep.equal([1, 2, 3, 4, 5]);
    });

    it('should handle single buffer', function() {
      var a = Buffer.from([1, 2, 3]);
      var result = bufferUtils.concat(a);

      expect(Array.from(result)).to.deep.equal([1, 2, 3]);
    });

    it('should handle empty buffers', function() {
      var a = Buffer.from([1, 2]);
      var b = Buffer.from([]);
      var c = Buffer.from([3]);

      var result = bufferUtils.concat(a, b, c);

      expect(Array.from(result)).to.deep.equal([1, 2, 3]);
    });
  });

  describe('#fill()', function() {

    it('should fill buffer with value', function() {
      var buf = Buffer.alloc(5);
      bufferUtils.fill(buf, 42);

      expect(Array.from(buf)).to.deep.equal([42, 42, 42, 42, 42]);
    });

    it('should return the same buffer', function() {
      var buf = Buffer.alloc(3);
      var result = bufferUtils.fill(buf, 1);

      expect(result).to.equal(buf);
    });
  });

  describe('#clear()', function() {

    it('should fill buffer with zeros', function() {
      var buf = Buffer.from([1, 2, 3, 4, 5]);
      bufferUtils.clear(buf);

      expect(Array.from(buf)).to.deep.equal([0, 0, 0, 0, 0]);
    });

    it('should return the same buffer', function() {
      var buf = Buffer.from([1, 2, 3]);
      var result = bufferUtils.clear(buf);

      expect(result).to.equal(buf);
    });
  });
});

// Test compatibility with typical blockchain operations
describe('bufferUtils Blockchain Operations', function() {

  describe('Transaction ID Reversal', function() {

    it('should correctly reverse a txid for display', function() {
      // Simulating a raw txid from the blockchain
      var rawTxid = Buffer.from(
        'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        'hex'
      );

      var reversed = bufferUtils.reverseCopy(rawTxid);
      var displayTxid = reversed.toString('hex');

      // The reversed txid should be the original bytes in reverse order
      expect(displayTxid).to.equal(
        '55b852781b9995a44c939b64e441ae2724b96f99c8f4fb9a141cfc9842c4b0e3'
      );
    });

    it('should handle genesis block hash reversal', function() {
      // Genesis hash (example)
      var genesisHash = Buffer.alloc(32);
      genesisHash.fill(0);
      genesisHash[0] = 0x01;
      genesisHash[31] = 0xFF;

      bufferUtils.reverse(genesisHash);

      expect(genesisHash[0]).to.equal(0xFF);
      expect(genesisHash[31]).to.equal(0x01);
    });
  });
});

console.log('bufferUtils tests loaded successfully');

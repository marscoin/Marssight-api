'use strict';

/**
 * Unit tests for lib/microtime.js
 *
 * Tests the pure JavaScript microtime implementation.
 */

var chai = require('chai');
var expect = chai.expect;
var microtime = require('../lib/microtime');

describe('microtime', function() {

  describe('#now()', function() {

    it('should return a number', function() {
      var result = microtime.now();
      expect(result).to.be.a('number');
    });

    it('should return microseconds since epoch', function() {
      var result = microtime.now();
      // Should be in the range of current time
      // Current time in microseconds should be around 1.7e15 (2024)
      expect(result).to.be.greaterThan(1700000000000000);
      expect(result).to.be.lessThan(2000000000000000);
    });

    it('should be monotonically increasing', function() {
      var results = [];
      for (var i = 0; i < 100; i++) {
        results.push(microtime.now());
      }

      for (var i = 1; i < results.length; i++) {
        expect(results[i]).to.be.at.least(results[i - 1]);
      }
    });

    it('should increase over time', function(done) {
      var first = microtime.now();
      setTimeout(function() {
        var second = microtime.now();
        // After 10ms, should be at least 10000 microseconds later
        expect(second - first).to.be.at.least(9000);
        done();
      }, 10);
    });

    it('should be close to Date.now() * 1000', function() {
      var microNow = microtime.now();
      var dateNow = Date.now() * 1000;

      // Should be within 1 second (1000000 microseconds)
      expect(Math.abs(microNow - dateNow)).to.be.lessThan(1000000);
    });
  });

  describe('#nowDouble()', function() {

    it('should return array with two elements', function() {
      var result = microtime.nowDouble();
      expect(result).to.be.an('array');
      expect(result.length).to.equal(2);
    });

    it('should return [seconds, microseconds]', function() {
      var result = microtime.nowDouble();
      var seconds = result[0];
      var microseconds = result[1];

      // Seconds should be reasonable
      expect(seconds).to.be.greaterThan(1700000000);
      expect(seconds).to.be.lessThan(2000000000);

      // Microseconds should be 0-999999
      expect(microseconds).to.be.at.least(0);
      expect(microseconds).to.be.lessThan(1000000);
    });

    it('should be consistent with now()', function() {
      var nowResult = microtime.now();
      var doubleResult = microtime.nowDouble();
      var reconstructed = (doubleResult[0] * 1000000) + doubleResult[1];

      // Should be close (within 1ms = 1000us)
      expect(Math.abs(nowResult - reconstructed)).to.be.lessThan(1000);
    });
  });

  describe('#nowStruct()', function() {

    it('should return a floating point number', function() {
      var result = microtime.nowStruct();
      expect(result).to.be.a('number');
    });

    it('should be seconds since epoch', function() {
      var result = microtime.nowStruct();
      // Should be in the range of current time in seconds
      expect(result).to.be.greaterThan(1700000000);
      expect(result).to.be.lessThan(2000000000);
    });

    it('should have fractional part', function() {
      var result = microtime.nowStruct();
      var fractional = result - Math.floor(result);

      // The fractional part represents microseconds
      expect(fractional).to.be.at.least(0);
      expect(fractional).to.be.lessThan(1);
    });
  });

  describe('Use case: Message timestamps', function() {

    it('should generate unique timestamps for rapid operations', function() {
      var timestamps = new Set();
      for (var i = 0; i < 1000; i++) {
        timestamps.add(microtime.now());
      }

      // We should get mostly unique timestamps
      // (may have some duplicates on very fast systems)
      expect(timestamps.size).to.be.at.least(100);
    });

    it('should work as key suffix', function() {
      var prefix = 'msg-pubkey123-';
      var key = prefix + Math.round(microtime.now());

      expect(key).to.be.a('string');
      expect(key.startsWith(prefix)).to.be.true;
      expect(key.length).to.be.greaterThan(prefix.length);
    });
  });
});

console.log('microtime tests loaded successfully');

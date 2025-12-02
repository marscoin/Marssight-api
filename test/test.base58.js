'use strict';

/**
 * Unit tests for lib/base58.js
 *
 * Tests the pure JavaScript Base58/Base58Check implementation.
 * Uses known test vectors from Bitcoin.
 */

var chai = require('chai');
var expect = chai.expect;
var base58Module = require('../lib/base58');
var base58 = base58Module.base58;
var base58Check = base58Module.base58Check;

describe('base58', function() {

  describe('#encode()', function() {

    it('should encode empty buffer', function() {
      var result = base58.encode(Buffer.alloc(0));
      expect(result).to.equal('');
    });

    it('should encode single byte', function() {
      var result = base58.encode(Buffer.from([0]));
      expect(result).to.equal('1');
    });

    it('should encode leading zeros as 1s', function() {
      var result = base58.encode(Buffer.from([0, 0, 0, 1]));
      expect(result.substring(0, 3)).to.equal('111');
    });

    it('should encode known test vector', function() {
      // "Hello World" in hex
      var buf = Buffer.from('Hello World', 'utf8');
      var result = base58.encode(buf);
      expect(result).to.equal('JxF12TrwUP45BMd');
    });

    it('should encode hex test vector', function() {
      // Standard Bitcoin test vector
      var buf = Buffer.from('0000000000000000000000', 'hex');
      var result = base58.encode(buf);
      // 11 zero bytes = 11 '1's
      expect(result).to.equal('11111111111');
    });
  });

  describe('#decode()', function() {

    it('should decode empty string', function() {
      var result = base58.decode('');
      expect(result.length).to.equal(0);
    });

    it('should decode single 1', function() {
      var result = base58.decode('1');
      expect(result.length).to.equal(1);
      expect(result[0]).to.equal(0);
    });

    it('should decode leading 1s as zeros', function() {
      var result = base58.decode('111abc');
      expect(result[0]).to.equal(0);
      expect(result[1]).to.equal(0);
      expect(result[2]).to.equal(0);
    });

    it('should decode known test vector', function() {
      var result = base58.decode('JxF12TrwUP45BMd');
      expect(result.toString('utf8')).to.equal('Hello World');
    });

    it('should throw on invalid character', function() {
      expect(function() {
        base58.decode('Invalid0Char');
      }).to.throw('Invalid base58 character');
    });

    it('should round-trip encode/decode', function() {
      var original = Buffer.from('test data for base58 encoding', 'utf8');
      var encoded = base58.encode(original);
      var decoded = base58.decode(encoded);

      expect(decoded.equals(original)).to.be.true;
    });
  });
});

describe('base58Check', function() {

  describe('#encode() and #decode()', function() {

    it('should round-trip encode/decode', function() {
      var original = Buffer.from([0x00, 0x14, 0x89, 0xAB, 0xCD, 0xEF]);
      var encoded = base58Check.encode(original);
      var decoded = base58Check.decode(encoded);

      expect(decoded.equals(original)).to.be.true;
    });

    it('should throw on too short input', function() {
      expect(function() {
        base58Check.decode('abc');
      }).to.throw('too short');
    });

    it('should throw on checksum mismatch', function() {
      var valid = base58Check.encode(Buffer.from([0x00, 0x01, 0x02]));
      // Corrupt the last character
      var lastChar = valid[valid.length - 1];
      var newChar = lastChar === 'a' ? 'b' : 'a';
      var invalid = valid.substring(0, valid.length - 1) + newChar;

      expect(function() {
        base58Check.decode(invalid);
      }).to.throw('Checksum mismatch');
    });
  });

  describe('Bitcoin Address Encoding', function() {

    it('should encode mainnet P2PKH address format', function() {
      // Version byte 0x00 + 20-byte hash
      var versionAndHash = Buffer.alloc(21);
      versionAndHash[0] = 0x00; // Mainnet P2PKH version
      versionAndHash.fill(0xAB, 1, 21); // Dummy 20-byte hash

      var address = base58Check.encode(versionAndHash);

      // Should start with '1' for mainnet P2PKH
      expect(address[0]).to.equal('1');
    });

    it('should encode Marscoin address format', function() {
      // Version byte 0x32 (50) + 20-byte hash for Marscoin
      var versionAndHash = Buffer.alloc(21);
      versionAndHash[0] = 0x32; // Marscoin mainnet version (50 = 'M')
      versionAndHash.fill(0xAB, 1, 21); // Dummy 20-byte hash

      var address = base58Check.encode(versionAndHash);

      // Should start with 'M' for Marscoin mainnet
      expect(address[0]).to.equal('M');
    });

    it('should decode and verify valid address', function() {
      // Create a valid address
      var versionAndHash = Buffer.alloc(21);
      versionAndHash[0] = 0x32; // Marscoin
      for (var i = 1; i < 21; i++) {
        versionAndHash[i] = i;
      }

      var address = base58Check.encode(versionAndHash);
      var decoded = base58Check.decode(address);

      expect(decoded[0]).to.equal(0x32);
      expect(decoded.length).to.equal(21);
    });
  });

  describe('Performance', function() {

    it('should handle many encode/decode cycles', function() {
      var data = Buffer.alloc(32);
      for (var i = 0; i < 32; i++) {
        data[i] = i * 8;
      }

      for (var i = 0; i < 100; i++) {
        var encoded = base58Check.encode(data);
        var decoded = base58Check.decode(encoded);
        expect(decoded.equals(data)).to.be.true;
      }
    });

    it('should handle various buffer sizes', function() {
      for (var size = 1; size <= 100; size++) {
        var data = Buffer.alloc(size);
        for (var i = 0; i < size; i++) {
          data[i] = i % 256;
        }

        var encoded = base58Check.encode(data);
        var decoded = base58Check.decode(encoded);
        expect(decoded.equals(data)).to.be.true;
      }
    });
  });
});

// Test vectors from Bitcoin
describe('Bitcoin Test Vectors', function() {

  var testVectors = [
    {
      hex: '',
      base58: ''
    },
    {
      hex: '61',
      base58: '2g'
    },
    {
      hex: '626262',
      base58: 'a3gV'
    },
    {
      hex: '636363',
      base58: 'aPEr'
    },
    {
      hex: '73696d706c792061206c6f6e6720737472696e67',
      base58: '2cFupjhnEsSn59qHXstmK2ffpLv2'
    },
    {
      hex: '00eb15231dfceb60925886b67d065299925915aeb172c06647',
      base58: '1NS17iag9jJgTHD1VXjvLCEnZuQ3rJDE9L'
    },
    {
      hex: '00000000000000000000',
      base58: '1111111111'
    }
  ];

  testVectors.forEach(function(vector, index) {
    it('should pass test vector ' + (index + 1), function() {
      var buf = Buffer.from(vector.hex, 'hex');
      var encoded = base58.encode(buf);
      expect(encoded).to.equal(vector.base58);

      if (vector.base58.length > 0) {
        var decoded = base58.decode(vector.base58);
        expect(decoded.toString('hex')).to.equal(vector.hex);
      }
    });
  });
});

console.log('base58 tests loaded successfully');

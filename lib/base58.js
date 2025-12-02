'use strict';

/**
 * Base58 and Base58Check Encoding/Decoding
 *
 * Pure JavaScript implementation - no native dependencies.
 * Compatible with the original bitcore/Litecore Base58 module.
 *
 * Based on the Base58 algorithm used in Bitcoin/cryptocurrency addresses.
 */

var crypto = require('crypto');

var ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
var ALPHABET_MAP = {};
for (var i = 0; i < ALPHABET.length; i++) {
  ALPHABET_MAP[ALPHABET[i]] = i;
}
var BASE = 58;

/**
 * Vanilla Base58 Encoding
 */
var base58 = {
  /**
   * Encode a buffer to base58 string
   * @param {Buffer} buffer - Input buffer
   * @returns {string} Base58 encoded string
   */
  encode: function(buffer) {
    if (buffer.length === 0) return '';

    // Count leading zeros
    var leadingZeros = 0;
    for (var i = 0; i < buffer.length; i++) {
      if (buffer[i] === 0) {
        leadingZeros++;
      } else {
        break;
      }
    }

    // Convert buffer to array of digits in base58
    // We work with the buffer as a big number in base 256
    var digits = [0];
    for (var i = 0; i < buffer.length; i++) {
      var carry = buffer[i];
      for (var j = 0; j < digits.length; j++) {
        carry += digits[j] << 8;
        digits[j] = carry % BASE;
        carry = (carry / BASE) | 0;
      }
      while (carry > 0) {
        digits.push(carry % BASE);
        carry = (carry / BASE) | 0;
      }
    }

    // Skip trailing zeros in digits array (they're leading zeros in result)
    var lastNonZero = digits.length - 1;
    while (lastNonZero >= 0 && digits[lastNonZero] === 0) {
      lastNonZero--;
    }

    // Convert digits to base58 characters
    var result = '';

    // Add leading '1's for leading zeros in input
    for (var i = 0; i < leadingZeros; i++) {
      result += ALPHABET[0];
    }

    // Add the rest (digits are in reverse order)
    for (var i = lastNonZero; i >= 0; i--) {
      result += ALPHABET[digits[i]];
    }

    return result;
  },

  /**
   * Decode a base58 string to buffer
   * @param {string} str - Base58 encoded string
   * @returns {Buffer} Decoded buffer
   */
  decode: function(str) {
    if (str.length === 0) return Buffer.alloc(0);

    // Count leading '1's (they represent leading zeros)
    var leadingOnes = 0;
    for (var i = 0; i < str.length; i++) {
      if (str[i] === ALPHABET[0]) {
        leadingOnes++;
      } else {
        break;
      }
    }

    // Convert base58 string to bytes
    var bytes = [0];
    for (var i = 0; i < str.length; i++) {
      var value = ALPHABET_MAP[str[i]];
      if (value === undefined) {
        throw new Error('Invalid base58 character: ' + str[i]);
      }

      var carry = value;
      for (var j = 0; j < bytes.length; j++) {
        carry += bytes[j] * BASE;
        bytes[j] = carry & 0xff;
        carry >>= 8;
      }
      while (carry > 0) {
        bytes.push(carry & 0xff);
        carry >>= 8;
      }
    }

    // Remove leading zeros from bytes (they come from leading '1's)
    while (bytes.length > 0 && bytes[bytes.length - 1] === 0) {
      bytes.pop();
    }

    // Reverse bytes and prepend leading zeros
    var result = Buffer.alloc(leadingOnes + bytes.length);
    result.fill(0, 0, leadingOnes);
    for (var i = 0; i < bytes.length; i++) {
      result[leadingOnes + i] = bytes[bytes.length - 1 - i];
    }

    return result;
  }
};

/**
 * SHA256 hash
 */
function sha256(data) {
  return crypto.createHash('sha256').update(data).digest();
}

/**
 * Double SHA256 hash (used in Bitcoin/cryptocurrency checksums)
 */
function doubleSHA256(data) {
  return sha256(sha256(data));
}

/**
 * Base58Check Encoding (with checksum)
 */
var base58Check = {
  /**
   * Encode a buffer to base58check string (with checksum)
   * @param {Buffer} buf - Input buffer
   * @returns {string} Base58check encoded string
   */
  encode: function(buf) {
    var hash = doubleSHA256(buf);
    var checksum = hash.slice(0, 4);
    var checked = Buffer.concat([buf, checksum]);
    return base58.encode(checked);
  },

  /**
   * Decode a base58check string to buffer (verifies checksum)
   * @param {string} str - Base58check encoded string
   * @returns {Buffer} Decoded buffer (without checksum)
   * @throws {Error} If checksum doesn't match
   */
  decode: function(str) {
    var buf = base58.decode(str);

    if (buf.length < 4) {
      throw new Error('Invalid input: too short');
    }

    var data = buf.slice(0, -4);
    var checksum = buf.slice(-4);
    var hash = doubleSHA256(data);
    var expectedChecksum = hash.slice(0, 4);

    if (!checksum.equals(expectedChecksum)) {
      throw new Error('Checksum mismatch');
    }

    return data;
  }
};

// Export everything with same interface as original
exports.base58 = base58;
exports.base58Check = base58Check;
exports.encode = base58.encode;
exports.decode = base58.decode;

// For drop-in compatibility
exports.setBuffer = function() {
  // No-op - we don't use a global buffer
};

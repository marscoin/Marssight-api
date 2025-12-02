'use strict';

/**
 * Buffer Utilities - Modern replacements for native buffertools module
 *
 * This module provides pure JavaScript implementations of buffer operations
 * that previously required the native buffertools module.
 *
 * Compatible with Node.js 10+
 */

/**
 * Reverse a buffer in place (mutates the original)
 * Equivalent to buffertools.reverse(buffer)
 *
 * @param {Buffer} buffer - The buffer to reverse
 * @returns {Buffer} The same buffer, reversed
 */
exports.reverse = function(buffer) {
  var len = buffer.length;
  var half = Math.floor(len / 2);
  for (var i = 0; i < half; i++) {
    var tmp = buffer[i];
    buffer[i] = buffer[len - 1 - i];
    buffer[len - 1 - i] = tmp;
  }
  return buffer;
};

/**
 * Create a reversed copy of a buffer (does not mutate original)
 *
 * @param {Buffer} buffer - The buffer to reverse
 * @returns {Buffer} A new buffer with reversed contents
 */
exports.reverseCopy = function(buffer) {
  return Buffer.from(buffer).reverse();
};

/**
 * Compare two buffers
 * Equivalent to buffertools.compare(a, b)
 *
 * @param {Buffer} a - First buffer
 * @param {Buffer} b - Second buffer
 * @returns {number} -1 if a < b, 0 if equal, 1 if a > b
 */
exports.compare = function(a, b) {
  return Buffer.compare(a, b);
};

/**
 * Check if two buffers are equal
 * Equivalent to buffertools.equals(a, b)
 *
 * @param {Buffer} a - First buffer
 * @param {Buffer} b - Second buffer
 * @returns {boolean} True if buffers are equal
 */
exports.equals = function(a, b) {
  return a.equals(b);
};

/**
 * Concatenate multiple buffers
 * Equivalent to buffertools.concat(...)
 *
 * @param {...Buffer} buffers - Buffers to concatenate
 * @returns {Buffer} Concatenated buffer
 */
exports.concat = function() {
  var buffers = Array.prototype.slice.call(arguments);
  return Buffer.concat(buffers);
};

/**
 * Fill a buffer with a value
 * Equivalent to buffertools.fill(buffer, value)
 *
 * @param {Buffer} buffer - The buffer to fill
 * @param {number|string|Buffer} value - Value to fill with
 * @returns {Buffer} The filled buffer
 */
exports.fill = function(buffer, value) {
  buffer.fill(value);
  return buffer;
};

/**
 * Clear a buffer (fill with zeros)
 * Equivalent to buffertools.clear(buffer)
 *
 * @param {Buffer} buffer - The buffer to clear
 * @returns {Buffer} The cleared buffer
 */
exports.clear = function(buffer) {
  buffer.fill(0);
  return buffer;
};

'use strict';

/**
 * Microtime - Pure JavaScript replacement for native microtime module
 *
 * Provides microsecond-precision timestamps without native dependencies.
 * Compatible with Node.js 10+
 */

// Start time for hrtime calculations
var startTime = Date.now();
var startHrtime = process.hrtime();

/**
 * Get current time in microseconds since Unix epoch
 * @returns {number} Microseconds since epoch
 */
exports.now = function() {
  var diff = process.hrtime(startHrtime);
  // diff[0] = seconds, diff[1] = nanoseconds
  // Convert to microseconds and add to start time
  var microsecondsElapsed = (diff[0] * 1000000) + Math.floor(diff[1] / 1000);
  return (startTime * 1000) + microsecondsElapsed;
};

/**
 * Get current time as [seconds, microseconds] array
 * @returns {number[]} [seconds, microseconds]
 */
exports.nowDouble = function() {
  var now = exports.now();
  var seconds = Math.floor(now / 1000000);
  var microseconds = now % 1000000;
  return [seconds, microseconds];
};

/**
 * Get current time as floating point seconds
 * @returns {number} Seconds since epoch with microsecond precision
 */
exports.nowStruct = function() {
  return exports.now() / 1000000;
};

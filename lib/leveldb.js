'use strict';

/**
 * LevelDB Compatibility Layer
 *
 * Provides the old levelup/leveldown API using modern classic-level.
 * This allows legacy code to work with modern Node.js without modification.
 */

var ClassicLevel;
try {
  ClassicLevel = require('classic-level').ClassicLevel;
} catch (e) {
  // Fallback to old levelup if classic-level not available
  console.warn('classic-level not found, falling back to levelup');
  module.exports = {
    levelup: require('levelup'),
    destroy: require('leveldown').destroy
  };
  return;
}

var Readable = require('stream').Readable;
var EventEmitter = require('events').EventEmitter;

/**
 * Create a Node.js readable stream from a classic-level iterator
 *
 * classic-level iterator.next() returns:
 * - [key, value] when there's data
 * - undefined when done
 */
function iteratorToStream(iterator, options) {
  options = options || {};
  var stream = new Readable({ objectMode: true, highWaterMark: 16 });
  var ended = false;

  stream._read = function() {
    if (ended) return;

    iterator.next().then(function(entry) {
      if (!entry || ended) {
        // No more data
        ended = true;
        iterator.close().then(function() {
          stream.push(null);
        }).catch(function(err) {
          stream.destroy(err);
        });
      } else {
        // entry is [key, value]
        var key = entry[0];
        var value = entry[1];
        var transformed;

        if (options.keys && options.values !== false) {
          // Normal read stream with key and value
          transformed = { key: key, value: value };
        } else if (options.keys && options.values === false) {
          // Key stream
          transformed = key;
        } else if (options.values && options.keys === false) {
          // Value stream
          transformed = value;
        } else {
          // Default: both key and value
          transformed = { key: key, value: value };
        }

        if (!stream.push(transformed)) {
          // Backpressure - wait for next _read call
        }
      }
    }).catch(function(err) {
      ended = true;
      stream.destroy(err);
    });
  };

  stream._destroy = function(err, callback) {
    ended = true;
    iterator.close().then(function() {
      callback(err);
    }).catch(callback);
  };

  return stream;
}

/**
 * Wrapper class that provides levelup-compatible API
 */
function LevelWrapper(db) {
  this._db = db;
  this._isOpen = true;
}

// Inherit from EventEmitter for open/ready events
LevelWrapper.prototype = Object.create(EventEmitter.prototype);
LevelWrapper.prototype.constructor = LevelWrapper;

LevelWrapper.prototype.put = function(key, value, options, callback) {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }

  var promise = this._db.put(key, value, options || {});

  if (callback) {
    promise.then(function() {
      callback(null);
    }).catch(callback);
  }

  return promise;
};

LevelWrapper.prototype.get = function(key, options, callback) {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }

  var promise = this._db.get(key, options || {});

  if (callback) {
    promise.then(function(value) {
      // classic-level returns undefined for missing keys
      // old levelup threw NotFoundError
      if (value === undefined) {
        var err = new Error('Key not found in database [' + key + ']');
        err.notFound = true;
        err.status = 404;
        err.code = 'LEVEL_NOT_FOUND';
        callback(err);
      } else {
        callback(null, value);
      }
    }).catch(function(err) {
      // Convert LEVEL_NOT_FOUND to NotFoundError for compatibility
      if (err.code === 'LEVEL_NOT_FOUND') {
        err.notFound = true;
        err.status = 404;
      }
      callback(err);
    });
  }

  return promise;
};

LevelWrapper.prototype.del = function(key, options, callback) {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }

  var promise = this._db.del(key, options || {});

  if (callback) {
    promise.then(function() {
      callback(null);
    }).catch(callback);
  }

  return promise;
};

LevelWrapper.prototype.batch = function(ops, options, callback) {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }

  // If no ops, return chainable batch
  if (!Array.isArray(ops)) {
    return this._db.batch();
  }

  var promise = this._db.batch(ops, options || {});

  if (callback) {
    promise.then(function() {
      callback(null);
    }).catch(callback);
  }

  return promise;
};

LevelWrapper.prototype.close = function(callback) {
  var self = this;
  var promise = this._db.close();

  if (callback) {
    promise.then(function() {
      self._isOpen = false;
      callback(null);
    }).catch(callback);
  }

  return promise;
};

LevelWrapper.prototype.isOpen = function() {
  return this._isOpen && this._db.status === 'open';
};

LevelWrapper.prototype.isClosed = function() {
  return !this._isOpen || this._db.status === 'closed';
};

LevelWrapper.prototype.createReadStream = function(options) {
  options = options || {};

  // Map old option names to new ones
  var iteratorOptions = {
    keys: true,
    values: true
  };

  if (options.start !== undefined) {
    iteratorOptions.gte = options.start;
  }
  if (options.end !== undefined) {
    iteratorOptions.lte = options.end;
  }
  if (options.gt !== undefined) {
    iteratorOptions.gt = options.gt;
  }
  if (options.gte !== undefined) {
    iteratorOptions.gte = options.gte;
  }
  if (options.lt !== undefined) {
    iteratorOptions.lt = options.lt;
  }
  if (options.lte !== undefined) {
    iteratorOptions.lte = options.lte;
  }
  if (options.reverse !== undefined) {
    iteratorOptions.reverse = options.reverse;
  }
  if (options.limit !== undefined) {
    iteratorOptions.limit = options.limit;
  }
  if (options.keys !== undefined) {
    iteratorOptions.keys = options.keys;
  }
  if (options.values !== undefined) {
    iteratorOptions.values = options.values;
  }

  var iterator = this._db.iterator(iteratorOptions);
  return iteratorToStream(iterator, { keys: true, values: true });
};

LevelWrapper.prototype.createKeyStream = function(options) {
  options = options || {};

  var iteratorOptions = {
    keys: true,
    values: false
  };

  if (options.start !== undefined) {
    iteratorOptions.gte = options.start;
  }
  if (options.end !== undefined) {
    iteratorOptions.lte = options.end;
  }
  if (options.gt !== undefined) {
    iteratorOptions.gt = options.gt;
  }
  if (options.gte !== undefined) {
    iteratorOptions.gte = options.gte;
  }
  if (options.lt !== undefined) {
    iteratorOptions.lt = options.lt;
  }
  if (options.lte !== undefined) {
    iteratorOptions.lte = options.lte;
  }
  if (options.reverse !== undefined) {
    iteratorOptions.reverse = options.reverse;
  }
  if (options.limit !== undefined) {
    iteratorOptions.limit = options.limit;
  }

  var iterator = this._db.iterator(iteratorOptions);
  return iteratorToStream(iterator, { keys: true, values: false });
};

LevelWrapper.prototype.createValueStream = function(options) {
  options = options || {};

  var iteratorOptions = {
    keys: false,
    values: true
  };

  if (options.start !== undefined) {
    iteratorOptions.gte = options.start;
  }
  if (options.end !== undefined) {
    iteratorOptions.lte = options.end;
  }
  if (options.reverse !== undefined) {
    iteratorOptions.reverse = options.reverse;
  }
  if (options.limit !== undefined) {
    iteratorOptions.limit = options.limit;
  }

  var iterator = this._db.iterator(iteratorOptions);
  return iteratorToStream(iterator, { keys: false, values: true });
};

// Emit events on the wrapper
LevelWrapper.prototype.on = function(event, listener) {
  EventEmitter.prototype.on.call(this, event, listener);
  return this;
};

/**
 * Create a levelup-compatible database
 */
function levelup(path, options, callback) {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }

  options = options || {};

  // Map old options to new
  var classicOptions = {};

  if (options.valueEncoding === 'json') {
    classicOptions.valueEncoding = 'json';
  }

  // Create the database
  var db;
  try {
    db = new ClassicLevel(path, classicOptions);
  } catch (err) {
    if (callback) {
      setImmediate(function() { callback(err); });
      return;
    }
    throw err;
  }

  var wrapper = new LevelWrapper(db);

  // Open is automatic in classic-level, but we emit ready for compatibility
  db.open().then(function() {
    wrapper.emit('ready');
    wrapper.emit('open');
    if (callback) callback(null, wrapper);
  }).catch(function(err) {
    if (callback) callback(err);
    else wrapper.emit('error', err);
  });

  return wrapper;
}

/**
 * Destroy a database
 */
function destroy(path, callback) {
  ClassicLevel.destroy(path).then(function() {
    if (callback) callback(null);
  }).catch(function(err) {
    if (callback) callback(err);
  });
}

module.exports = {
  levelup: levelup,
  destroy: destroy,
  ClassicLevel: ClassicLevel
};

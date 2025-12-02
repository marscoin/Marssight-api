'use strict';

/**
 * Unit tests for lib/leveldb.js
 *
 * Tests the levelup-compatible API wrapper for classic-level.
 */

var chai = require('chai');
var expect = chai.expect;
var path = require('path');
var fs = require('fs');
var os = require('os');
var leveldb = require('../lib/leveldb');

var testDbPath = path.join(os.tmpdir(), 'leveldb-test-' + Date.now());

describe('leveldb compatibility layer', function() {
  var db;

  before(function(done) {
    // Ensure test directory doesn't exist
    if (fs.existsSync(testDbPath)) {
      fs.rmSync(testDbPath, { recursive: true });
    }
    done();
  });

  after(function(done) {
    // Clean up
    if (db) {
      db.close(function() {
        leveldb.destroy(testDbPath, done);
      });
    } else {
      done();
    }
  });

  describe('levelup()', function() {

    it('should create a database', function(done) {
      db = leveldb.levelup(testDbPath, function(err, openedDb) {
        expect(err).to.be.null;
        expect(openedDb).to.exist;
        done();
      });
    });

    it('should emit ready event', function(done) {
      var testPath = testDbPath + '-ready';
      var newDb = leveldb.levelup(testPath);
      newDb.on('ready', function() {
        newDb.close(function() {
          leveldb.destroy(testPath, done);
        });
      });
    });
  });

  describe('put/get/del', function() {

    it('should put and get a string value', function(done) {
      db.put('test-key', 'test-value', function(err) {
        expect(err).to.be.null;
        db.get('test-key', function(err, value) {
          expect(err).to.be.null;
          expect(value).to.equal('test-value');
          done();
        });
      });
    });

    it('should delete a value', function(done) {
      db.put('delete-key', 'delete-value', function(err) {
        expect(err).to.be.null;
        db.del('delete-key', function(err) {
          expect(err).to.be.null;
          db.get('delete-key', function(err, value) {
            expect(err).to.exist;
            expect(err.notFound).to.be.true;
            done();
          });
        });
      });
    });

    it('should return notFound error for missing key', function(done) {
      db.get('nonexistent-key-12345', function(err, value) {
        expect(err).to.exist;
        expect(err.notFound).to.be.true;
        done();
      });
    });
  });

  describe('batch()', function() {

    it('should execute batch operations', function(done) {
      var ops = [
        { type: 'put', key: 'batch-1', value: 'value-1' },
        { type: 'put', key: 'batch-2', value: 'value-2' },
        { type: 'put', key: 'batch-3', value: 'value-3' }
      ];

      db.batch(ops, function(err) {
        expect(err).to.be.null;
        db.get('batch-1', function(err, value) {
          expect(err).to.be.null;
          expect(value).to.equal('value-1');
          db.get('batch-2', function(err, value) {
            expect(err).to.be.null;
            expect(value).to.equal('value-2');
            done();
          });
        });
      });
    });

    it('should support batch delete operations', function(done) {
      db.put('batch-del', 'will-delete', function(err) {
        expect(err).to.be.null;
        var ops = [{ type: 'del', key: 'batch-del' }];
        db.batch(ops, function(err) {
          expect(err).to.be.null;
          db.get('batch-del', function(err) {
            expect(err).to.exist;
            expect(err.notFound).to.be.true;
            done();
          });
        });
      });
    });
  });

  describe('createReadStream()', function() {

    before(function(done) {
      var ops = [
        { type: 'put', key: 'stream-a', value: 'A' },
        { type: 'put', key: 'stream-b', value: 'B' },
        { type: 'put', key: 'stream-c', value: 'C' }
      ];
      db.batch(ops, done);
    });

    it('should read all entries', function(done) {
      var entries = [];
      db.createReadStream()
        .on('data', function(data) {
          entries.push(data);
        })
        .on('end', function() {
          // Should have at least the stream entries
          expect(entries.length).to.be.at.least(3);
          done();
        })
        .on('error', done);
    });

    it('should support start/end range', function(done) {
      var entries = [];
      db.createReadStream({
        start: 'stream-a',
        end: 'stream-c'
      })
        .on('data', function(data) {
          entries.push(data);
        })
        .on('end', function() {
          expect(entries.length).to.equal(3);
          expect(entries[0].key).to.equal('stream-a');
          expect(entries[2].key).to.equal('stream-c');
          done();
        })
        .on('error', done);
    });

    it('should return key and value', function(done) {
      var found = false;
      db.createReadStream({
        start: 'stream-b',
        end: 'stream-b'
      })
        .on('data', function(data) {
          expect(data.key).to.equal('stream-b');
          expect(data.value).to.equal('B');
          found = true;
        })
        .on('end', function() {
          expect(found).to.be.true;
          done();
        })
        .on('error', done);
    });
  });

  describe('createKeyStream()', function() {

    it('should return only keys', function(done) {
      var keys = [];
      db.createKeyStream({
        start: 'stream-a',
        end: 'stream-c'
      })
        .on('data', function(key) {
          keys.push(key);
        })
        .on('end', function() {
          expect(keys.length).to.equal(3);
          expect(keys).to.include('stream-a');
          expect(keys).to.include('stream-b');
          expect(keys).to.include('stream-c');
          done();
        })
        .on('error', done);
    });
  });

  describe('JSON value encoding', function() {
    var jsonDb;
    var jsonDbPath = testDbPath + '-json';

    before(function(done) {
      jsonDb = leveldb.levelup(jsonDbPath, { valueEncoding: 'json' }, function(err) {
        if (err) return done(err);
        done();
      });
    });

    after(function(done) {
      if (jsonDb) {
        jsonDb.close(function() {
          leveldb.destroy(jsonDbPath, done);
        });
      } else {
        done();
      }
    });

    it('should store and retrieve JSON objects', function(done) {
      var obj = { name: 'test', value: 123, nested: { a: 1 } };
      jsonDb.put('json-key', obj, function(err) {
        expect(err).to.be.null;
        jsonDb.get('json-key', function(err, value) {
          expect(err).to.be.null;
          expect(value).to.deep.equal(obj);
          done();
        });
      });
    });
  });

  describe('destroy()', function() {

    it('should destroy a database', function(done) {
      var destroyPath = testDbPath + '-destroy';
      var destroyDb = leveldb.levelup(destroyPath, function(err) {
        expect(err).to.be.null;
        destroyDb.put('key', 'value', function(err) {
          expect(err).to.be.null;
          destroyDb.close(function(err) {
            expect(err).to.be.null;
            leveldb.destroy(destroyPath, function(err) {
              expect(err).to.be.null;
              // Database should be gone
              expect(fs.existsSync(destroyPath)).to.be.false;
              done();
            });
          });
        });
      });
    });
  });
});

console.log('leveldb tests loaded successfully');

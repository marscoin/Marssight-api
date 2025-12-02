'use strict';

var imports     = require('soop').imports();
var fs          = require('fs');
// buffertools removed - was not being used
var db          = imports.db || JSON.parse( fs.readFileSync(imports.poolMatchFile || './poolMatchFile.json'));

var PoolMatch = function() {
  var self = this;

  self.strings = {};
  db.forEach(function(pool) {
    pool.searchStrings.forEach(function(s) {
      self.strings[s] = {
        poolName: pool.poolName,
        url: pool.url
      };
    });
  });
};


PoolMatch.prototype.match = function(address) {
  var self = this;
  for(var k in self.strings) {
    if (address  == k) {
      return self.strings[k];
    }
  }
  return {poolName: "Unknown/Solo", url: "#"};
};

module.exports = require('soop')(PoolMatch);

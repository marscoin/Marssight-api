'use strict';

var https = require('https');
var config = require('../../config/config');

exports.index = function(req, res) {
  var _request = function(url, cb) {
    https.get(url, function(response) {
      var body = '';
      response.on('data', function(d) {
        body += d;
      });
      response.on('end', function() {
        if (response.statusCode === 200) {
          cb(false, body);
        } else {
          cb(true, {
            status: response.statusCode,
            message: 'Request error'
          });
        }
      });
    }).on('error', function(e) {
      cb(true, {
        status: '500',
        message: e.message
      });
    });
  };

  // Get page from query params, default to 1
  var page = req.query.page || 1;
  
  _request('https://martianrepublic.org/api/feed?page=' + page, function(err, data) {
    if (!err) {
      try {
        var jsonData = JSON.parse(data);
        res.jsonp({
          status: 200,
          data: jsonData
        });
      } catch (e) {
        res.status(500).send({
          error: 'Failed to parse response'
        });
      }
    } else {
      res.status(500).send({
        error: 'Failed to fetch notary data'
      });
    }
  });
};
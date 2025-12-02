'use strict';

var http = require('https');
var config = require('../../config/config');

// Set the initial vars
var timestamp = +new Date(),
    delay = config.currencyRefresh * 60000, // Assuming config.currencyRefresh is set
    marscoinRate = 0; // This will store the Marscoin rate

exports.index = function(req, res) {
  var _request = function(url, cb) {
    http.get(url, function(response) {
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

  // Init
  var currentTime = +new Date();
  if (marscoinRate === 0 || currentTime >= (timestamp + delay)) {
    timestamp = currentTime;

    _request('https://price.marscoin.org/json/', function(err, data) {
      if (!err) {
        try {
          // Parsing the JSON response to extract the Marscoin price
          var jsonData = JSON.parse(data);
          var marscoinPrice = jsonData.data["154"].quote.USD.price;
          marscoinRate = marscoinPrice; // Store the latest price

          res.jsonp({
            status: 200,
            data: { price: marscoinRate }
          });
        } catch (parseError) {
          // Handle JSON parsing error
          console.error('Error parsing Marscoin price JSON:', parseError.message);
          console.error('Raw response:', data);
          res.status(500).send({ error: 'Invalid response format from price API' });
        }
      } else {
        // Handle error: Could log the error or return a message
        res.status(500).send({ error: 'Failed to fetch Marscoin price' });
      }
    });
  } else {
    res.jsonp({
      status: 200,
      data: { price: marscoinRate }
    });
  }
};

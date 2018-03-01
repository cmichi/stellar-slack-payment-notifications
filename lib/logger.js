'use strict';

const getenv = require('getenv');
const intel = require('intel');

intel.basicConfig({
  format: '%-5(levelname)s: %(message)s',
  level: intel[(getenv('LOG_LEVEL', 'debug')).toUpperCase()],
});

module.exports = intel;

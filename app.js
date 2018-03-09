'use strict';

const server = require('./lib/server');
server.listen(4343, function(err) {
  if (err) {
    process.exit(1);
  }

  server.loadAuthorizations();
  server.startStreaming();
});

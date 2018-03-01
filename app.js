'use strict';

const server = require('./lib/server');
server.loadAuthorizations();
server.listen(4343, function(err) {
  if (err) {
    process.exit(1);
  }

  server.startStreaming();
});

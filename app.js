'use strict';

const server = require('./lib/server');
const port = process.env.PORT ? process.env.PORT : 4343;
server.listen(port, function(err) {
  if (err) {
    process.exit(1);
  }

  server.loadAuthorizations();
  server.startStreaming();
});

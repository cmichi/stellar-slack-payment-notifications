'use strict';

const assert = require('assert');
const fs = require('fs');

const async = require('async');
const request = require('supertest-as-promised');
const rewire = require('rewire');
const _ = require('lodash');

process.env.AUTHORIZATIONS_STORE = '/tmp/authorizationsStore';
process.env.SLACK_CLIENT_ID = '123';
process.env.SLACK_CLIENT_SECRET = '456';
const server = rewire('../../lib/server');

const stub = {
  payments: () => {
    return {
      forAccount: () => {
        return {
          cursor: () => {},
          stream: () => {
            return () => {};
          },
        };
      },
    };
  },
};
server.__set__('stellarServer', stub);

describe('HTTP methodds', function() {

  let app;
  before('initialize server', function(cb) {
    if (fs.existsSync(process.env.AUTHORIZATIONS_STORE)) {
      fs.unlinkSync(process.env.AUTHORIZATIONS_STORE, '');
    }
    fs.writeFileSync(process.env.AUTHORIZATIONS_STORE,
                     fs.readFileSync('test/fixtures/authorizationsStore'));
    server.loadAuthorizations();

    server.listen(1337, function(err, res) {
      app = res;
      cb(err);
    });
  });

  it('should return usage instructions', () =>
    request(app)
      .post('/')
      .send(null)
      .expect(200)
      .then((res) => {
        assert.strictEqual(_.startsWith(res.text, 'Usage:'), true);
      })
  );

  it('should not list any subscriptions', () =>
    request(app)
      .post('/')
      .send({
        'text': 'list',
        'team_id': '12345',
      })
      .expect(200)
      .then((res) => {
        assert.strictEqual(res.text,
                           'You currently don\'t have any subscriptions.');
      })
  );

  it('should add a subscription', (cb) => {
    request(app)
      .post('/')
      .send({
        'text': 'subscribe PUBKEY',
        'team_id': '12345',
        'channel_id': '6789',
        'channel_name': 'foochannel',
      })
      .expect(200)
      .then((res) => {
        assert.strictEqual(res.text,
                           'You will be notified on new payments for ' +
                           '`PUBKEY` in #foochannel.');
        waitFor((err) => {
          if (err) return false;

          const store = readStore(process.env.AUTHORIZATIONS_STORE);

          if (!store['12345'].subscriptions) {
            return false;
          }

          return store['12345'].subscriptions.PUBKEY6789 !== undefined;
        }, cb);
      });
  });

  it('should not add a subscription if already subscribed', () =>
    request(app)
      .post('/')
      .send({
        'text': 'subscribe PUBKEY',
        'team_id': '12345',
        'channel_id': '6789',
        'channel_name': 'foochannel',
      })
      .expect(200)
      .then((res) => {
        assert.strictEqual(res.text,
                           'This channel is already subscribed to payment ' +
                           'notifications for `PUBKEY`.');
      })
  );

  it('should remove a subscription', (cb) => {
    request(app)
      .post('/')
      .send({
        'text': 'unsubscribe PUBKEY',
        'team_id': '12345',
        'channel_id': '6789',
        'channel_name': 'foochannel',
      })
      .expect(200)
      .then((res) => {
        assert.strictEqual(res.text,
                           'Your subscription of `PUBKEY` for the channel ' +
                           '#foochannel was removed.');
        waitFor((err) => {
          if (err) return false;

          const store = readStore(process.env.AUTHORIZATIONS_STORE);

          if (_.get(store, '["12345"].subscriptions["PUBKEY6789"]')) {
            return false;
          }

          return true;
        }, cb);
      });
  });

  after('close server', function(cb) {
    server.close(cb);
  });

  function waitFor(test, cb) {
    async.until(test, (untilCb) => {
      setTimeout(untilCb, 500);
    }, cb);
  }

  function readStore(filename) {
    const content = fs.readFileSync(filename, {encoding: 'utf8'});
    return content.length === 0 ? '' : JSON.parse(content);
  }

});

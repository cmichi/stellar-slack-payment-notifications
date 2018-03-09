'use strict';

const fs = require('fs');

const StellarSdk = require('stellar-sdk');
const _ = require('lodash');

const logger = require('../lib/logger');
const slack = require('../lib/slack');

const authorizationsStore = process.env.AUTHORIZATIONS_STORE ?
  process.env.AUTHORIZATIONS_STORE : './authorizationsStore';
logger.info('Using ' + authorizationsStore);

const horizonUri = getenv('HORIZON_URI');
logger.info('Using horizonUri ' + horizonUri);
const stellarServer = new StellarSdk.Server(horizonUri);

let authorizations;
exports.loadAuthorizations = function() {
  authorizations = fs.existsSync(authorizationsStore) ?
    JSON.parse(fs.readFileSync(authorizationsStore, 'utf-8')) : {};
};

function flushStore() {
  fs.writeFile(authorizationsStore, JSON.stringify(authorizations, null, 2),
               (err) => {
                 if (err) throw err;
                 logger.info('Authorizations have been flushed to ' +
                             authorizationsStore);
               });
}
exports.flushStore = flushStore;

exports.authorize = function(jsonResponse) {
  authorizations[jsonResponse.team_id] = jsonResponse;
  flushStore();
};

exports.subscribe = function(req, res, cmds) {
  let subscription = req.body;
  subscription.channelName = req.body.channel_name;
  subscription.channelId = req.body.channel_id;
  subscription.accountId = cmds[1];
  let hash = subscription.accountId + subscription.channelId;

  logger.info('Received request for subscription: ' +
              JSON.stringify(subscription, null, 2));

  if (_.has(authorizations, [subscription.team_id, 'subscriptions', hash])) {
    res.send('This channel is already subscribed to payment notifications ' +
             'for `' + subscription.accountId + '`.');
    return;
  }

  // does account exist?
  stellarServer.loadAccount(subscription.accountId).then(function() {
    if (!authorizations[subscription.team_id].subscriptions) {
      authorizations[subscription.team_id].subscriptions = {};
    }

    authorizations[subscription.team_id].subscriptions[hash] = subscription;
    flushStore();
    createStream(subscription.team_id, hash);

    // this is a private message visible only to the user
    res.send('This channel will be ' +
             'notified when the account id `' + subscription.accountId +
             '` receives a new payment.');

  }).catch(function(err) {
    logger.error('Error when checking if account ' + subscription.accountId +
                ' exists: ', err.name, err.message);
    if (err.name === 'NotFoundError') {
      res.send('Error: We were unable to find the account id `' +
               subscription.accountId + '` on the horizon server ' +
               horizonUri + '. Please check that this is the correct ' +
               'account id.');
    } else {
      res.send('An unknown error occurred: `' + err.name + '` ' +
               '```' + JSON.stringify(err.message, null, 2) +
               '``` We were not able to subscribe you to the account id' +
               '`' + subscription.accountId + '`');
    }
  });
};

exports.unsubscribe = function(req, res, cmds) {
  let teamId = req.body.team_id;
  let accountId = cmds[1];
  let hash = accountId + req.body.channel_id;
  const channel = '<#' + req.body.channel_id + '|' + req.body.channel_name +
                  '>';

  if (!authorizations[teamId].subscriptions[hash]) {
    res.send('You are not subscribed to `' + accountId +
             '` in this channel (' + channel + ').');
    return;
  }

  authorizations[teamId].subscriptions[hash].closeStream();
  delete authorizations[teamId].subscriptions[hash];
  flushStore();
  res.send('Your subscription of `' + accountId + '` for the channel ' +
           channel + ' was removed.');
  return;
};

exports.list = function(req, res) {
  let teamId = req.body.team_id;
  if (!authorizations[teamId]) {
    res.send('Error: We couldn\'t find an authorization for your team.');
    return;
  }
  if (!authorizations[teamId].subscriptions) {
    res.send('You currently don\'t have any subscriptions.');
    return;
  }

  const subscriptions = authorizations[teamId].subscriptions;

  if (_.size(subscriptions) === 0) {
    res.send('You are currently not subscribed to any accounts.');
    return;
  }

  let list = '```';
  for (let s in subscriptions) {
    const channel = '<#' + subscriptions[s].channelId + '|' +
                    subscriptions[s].channelName + '>';
    list += subscriptions[s].accountId +
            ' to ' + channel + '\n';
  }
  res.send('These are your subscriptions: ' + list + '```');
};

function createStream(teamId, hash) {
  const subscription = authorizations[teamId].subscriptions[hash];
  const accountId = subscription.accountId;

  logger.info('Creating stream for ' + accountId +
              ' with token ' + subscription.lastSavedToken);

  const lastToken = subscription.lastSavedToken;
  streamPayments(hash, teamId, accountId, lastToken, newPayment, streamErr);

  function newPayment(payment) {
    if (payment.type !== 'payment') {
      return;
    }

    const fromWhen = (new Date()).getTime();
    const paymentDate = (new Date(payment.created_at)).getTime();
    if (paymentDate - fromWhen < 0) {
      const diff = paymentDate - fromWhen;
      logger.info('Skipping because ' + paymentDate + ' - ' +
                  fromWhen + ' = ' + diff + ' < 0');
      return;
    }
    logger.info('New payment in stream: ' + JSON.stringify(payment, null, 2));

    const asset = payment.asset_type === 'native' ?
      'lumens' : payment.asset_code + ':' + payment.asset_issuer;

    const amount = _.chain(payment.amount).trim('0').trimEnd('.').value();
    let text = amount + ' ' + asset + ' from `' + payment.from +
               '` to `' + payment.to + '`.';
    // + '\n' + payment._links.transaction.href;
    // todo should include memo

    if (payment.to !== accountId) {
      text = 'You sent: ' + text;
      // this service only posts payments which were received,
      // hence the line below is commented out.
      // slack.postToChannel(...);
    } else {
      logger.info('Posting new payment: ' + JSON.stringify(payment, null, 2));
      text = 'You just received ' + text;
      slack.postToChannel(subscription, text, authorizations, teamId,
                          _.partial(successfulSlackPost, payment),
                          authorizationRevoked);
    }
  }

  function successfulSlackPost(payment) {
    // save token once the slack post was successful
    authorizations[teamId].subscriptions[hash].pagingToken =
      payment.paging_token;

    // A possible error that could happen here is that two posts A and B
    // are issued at the same time to the same channel. A first, then B.
    // A fails at the first try and is retried 5s later. B succeeds the
    // first time. A then continues to fail until max attemps are
    // exhausted. The program then exits and is restarted by an external
    // entity at some point. The last saved cursor for this team would
    // then be the cursor of B (because the cursor saving happens at
    // successful posts), so the message A would never appear in the
    // channel then.
  }

  function authorizationRevoked(body) {
    const auth = authorizations[teamId];
    auth.subscriptions[hash].closeStream();
    delete authorizations[teamId];
    flushStore();
    logger.info('The token was revoked, the subscriptions and ' +
                'authentications for this account have been removed: ' +
                JSON.stringify(body, null, 2) + '\nThis was the ' +
                'authorization object which was removed: ' +
                JSON.stringify(auth, null, 2));
  }

  function streamErr(err) {
    if (!err) return;

    authorizations[teamId].subscriptions[hash].closeStream();
    delete authorizations[teamId].subscriptions[hash];
    flushStore();

    const channel = '<#' + subscription.channelId + '|' +
                    subscription.channelName + '>';
    if (err.status === 404) {
      const text = 'The subscription of `' + accountId + '` for the channel ' +
                   channel + ' had to be removed because we could ' +
                   'not find the account id on the horizon server ' +
                   horizonUri + '. This is the detailed error message: ```' +
                   JSON.stringify(err) + '```';
      slack.postToUser(subscription, text, authorizations, teamId,
                       null, authorizationRevoked);
    } else {
      const text = 'The subscription of `' + accountId + '` for the channel ' +
                   channel + ' had to be removed because this error ' +
                   'occurred: ```' + JSON.stringify(err) + '```';
      slack.postToUser(subscription, text, authorizations, teamId,
                       null, authorizationRevoked);
    }
  }
}
exports.createStream = createStream;

function streamPayments(hash, teamId, accountId, lastSavedToken, newPayment,
                        errorCb) {
  const payments = stellarServer.payments().forAccount(accountId);

  const lastToken = lastSavedToken ?
    payments.cursor(lastSavedToken) : payments.cursor('now');

  logger.info('Setting closeStream to teamId: ' + teamId + ', hash: ' + hash);
  authorizations[teamId].subscriptions[hash].closeStream = payments.stream({
    onmessage: function(payment) {
      logger.info('Payment: ' + JSON.stringify(payment, null, 2) +
                  '\naccountId: ' + accountId);
      newPayment(payment);
    },

    onerror: function(error) {
      logger.error('Error in payment stream: ' +
                   JSON.stringify(error, null, 2) + '\n' +
                   'lastToken: ' + lastToken +
                   'accountId: ' + accountId);

      if (error.status === 404) {
        // cancel this stream
        authorizations[teamId].subscriptions[hash].closeStream();

        errorCb(error);
      }
    },
  });
}

exports.startStreaming = function() {
  logger.info('Loading ' + _.size(authorizations) + ' authorizations');

  _.forEach(authorizations, (a /*, key */) => {
    _.forEach(a.subscriptions, (subscription, hash) => {
      createStream(a.team_id, hash);
    });
  });
};

function getenv(name) {
  if (!process.env[name]) {
    logger.error('The environment variable ' + name + ' is missing!');
    process.exit(1);
  }
  return process.env[name];
}


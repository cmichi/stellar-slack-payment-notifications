'use strict';

const fs = require('fs');

const bodyParser = require('body-parser');
const express = require('express');
const request = require('request');
const StellarSdk = require('stellar-sdk');
const _ = require('lodash');

const logger = require('../lib/logger');

const slackClientId = process.env.SLACK_CLIENT_ID;
const slackClientSecret = process.env.SLACK_CLIENT_SECRET;
const slackVerificationToken = process.env.SLACK_VERIFICATION_TOKEN;
if (!slackClientId || !slackClientSecret) {
  logger.error('Either the environment variable SLACK_CLIENT_ID, ' +
               'SLACK_CLIENT_SECRET, or SLACK_VERIFICATION_TOKEN ' +
               'is missing');
  process.exit(1);
}
const horizonUri = 'https://horizon-testnet.stellar.org';

const redirectUri =
  'https://stellar-payment-notifications.creal.de/auth/redirect';
const authorizationsStore = process.env.AUTHORIZATIONS_STORE ?
  process.env.AUTHORIZATIONS_STORE : './authorizationsStore';
logger.info('using ' + authorizationsStore);

const app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: true}));

logger.info('using horizon uri ', horizonUri);
const stellarServer = new StellarSdk.Server(horizonUri);

let server;
exports.listen = function(port, cb) {
  server = app.listen(port, () => {
    logger.info('Listening on port %d in %s mode',
                server.address().port, app.settings.env);
    cb(null, app);
  });
};

exports.close = function(cb) {
  server.close(cb);
};

let authorizations;
exports.loadAuthorizations = function() {
  authorizations = fs.existsSync(authorizationsStore) ?
    JSON.parse(fs.readFileSync(authorizationsStore, 'utf-8')) : {};
};

const txts = {
  cmdNotRecognized: 'Unfortunately I could not recognize your command.\n',
  help: 'Usage:```/stellar subscribe PUBLIC-KEY\n' +
        '/stellar unsubscribe PUBLIC-KEY\n/stellar list```\n\n' +
        'This Slack App is free software, you can view it\'s source code ' +
        'here: ' +
        'https://github.com/cmichi/stellar-slack-payment-notifications.\n\n' +
        'If you encounter any issues or need support please visit ' +
        'https://github.com/cmichi/stellar-slack-payment-notifications' +
        '#support.',
};

app.post('/', (req, res) => {
  if (req.body.token !== slackVerificationToken) {
    logger.error('The verification token which was sent (' + req.body.token +
                 ') does not match the verification token of the ' +
                 'Slash command.');
    res.status(403).send('The verification token you sent does not match ' +
                         'the verification token of the Slash command.');
    return;
  }

  let text = req.body.text;
  let cmds = _.trim(text).split(' ');
  _.pull(cmds, '');
  if (cmds.length === 0) {
    res.send(txts.help);
    return;
  }

  let subscription;
  let teamId;
  let hash;

  switch (cmds[0]) {
  case 'subscribe':
    if (cmds.length !== 2) {
      res.send(txts.cmdNotRecognized + txts.help);
      return;
    }

    subscription = req.body;
    subscription.channelName = req.body.channel_name;
    subscription.channelId = req.body.channel_id;
    subscription.accountId = cmds[1];
    hash = subscription.accountId + subscription.channelId;

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
    break;

  case 'unsubscribe':
    if (cmds.length !== 2) {
      res.send(txts.cmdNotRecognized + txts.help);
      return;
    }

    teamId = req.body.team_id;
    subscription = req.body;
    let accountId = cmds[1];
    hash = accountId + req.body.channel_id;
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

  case 'list':
    teamId = req.body.team_id;
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

    break;

  default:
    res.send(txts.cmdNotRecognized + txts.help);
    break;
  }
});

app.get('/', (req, res) =>{
  const uri = 'https://slack.com/oauth/authorize' +
              '?scope=commands,chat:write:bot' +
              '&client_id=308656001463.308680541383';
  res.send(`
    <a href="${uri}">
      <img
        alt="Add to Slack" height="40" width="139"
        src="https://platform.slack-edge.com/img/add_to_slack.png"
        srcset="https://platform.slack-edge.com/img/add_to_slack.png 1x,
        https://platform.slack-edge.com/img/add_to_slack@2x.png 2x" />
    </a>`);
});

app.get('/auth', (req, res) =>{
  const uri = 'https://slack.com/oauth/authorize' +
              '?scope=commands,chat:write:bot' +
              '&client_id=308656001463.308680541383';
  res.redirect(302, uri);
});

app.get('/auth/redirect', (req, res) => {
  const options = {
    uri: 'https://slack.com/api/oauth.access?code=' + req.query.code +
         '&client_id=' + slackClientId +
         '&client_secret=' + slackClientSecret +
         '&redirect_uri=' + redirectUri,
    method: 'GET',
  };
  request(options, (error, response, body) => {
    const jsonResponse = JSON.parse(body);
    if (!jsonResponse.ok) {
      res.send('Error encountered: \n' +
               JSON.stringify(jsonResponse)).status(200).end();
    } else {
      const team = jsonResponse.team_name;
      authorizations[jsonResponse.team_id] = jsonResponse;
      flushStore();

      const uri = 'https://' + team + '.slack.com/';
      res.redirect(301, uri);
      //res.send('Success! You will be forwarded to <a href="https://' +
      //         team + '.slack.com/">https://' + team + '.slack.com/</a>.');
    }
  });
});

function createStream(teamId, hash) {
  const subscription = authorizations[teamId].subscriptions[hash];
  const accountId = subscription.accountId;
  const token = authorizations[teamId].access_token;

  logger.info('Creating stream for ' + accountId +
              ' with token ' + subscription.lastSavedToken);

  const lastToken = subscription.lastSavedToken;
  streamPayments(hash, teamId, accountId, lastToken, function(payment) {
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
      //post(text, token);
    } else {
      logger.info('Posting new payment: ' + JSON.stringify(payment, null, 2));
      text = 'You just received ' + text;
      post(text, token);
    }
  }, function(token) {
    authorizations[teamId].subscriptions[hash].pagingToken = token;
  }, function(err) {
    if (!err) return;

    delete authorizations[teamId].subscriptions[hash];
    flushStore();

    const channel = '<#' + subscription.channelId + '|' +
                    subscription.channelName + '>';
    if (err.status === 404) {
      // todo should be posted to the user, not publicly
      post('The subscription of `' + accountId + '` for the channel ' +
           channel + ' had to be removed because we could ' +
           'not find the account id on the horizon server ' + horizonUri +
           '. This is the detailed error message: ```' + JSON.stringify(err) +
           '```', token);
    } else {
      post('The subscription of `' + accountId + '` for the channel ' +
           channel + ' had to be removed because this error ' +
           'occurred: ```' + JSON.stringify(err) + '```', token);
    }
  });

  function post(text, token) {
    var data = {
      channel: subscription.channelId,
      text: text,
    };

    var options = {
      url: 'https://slack.com/api/chat.postMessage',
      method: 'POST',
      body: data,
      json: true,
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json; charset=utf-8',
      },
    };

    request.post(options, (error, response, body) => {
      logger.info('Response when posting: ' +
                  JSON.stringify(body, null, 2));
      if (error) {
        logger.error('An client-side error occurred when trying to post to ' +
                     'the user: ' + JSON.stringify(error, null, 2));
        logger.error('What was tried to post: ' +
                     JSON.stringify(options, null, 2));
        // todo retry later
      }
      if (_.get(body, 'ok') === false) {
        logger.error('A server-side error occurred when trying to post to ' +
                     'the user: ' + JSON.stringify(body, null, 2));
        logger.error('What was tried to post: ' +
                     JSON.stringify(options, null, 2));
        // todo maybe remove the subscription?
        // body.error could e.g. be 'token_revoked'
      }
    });
  }
}

function streamPayments(hash, teamId, accountId, lastSavedToken, paymentCb,
                        savePagingToken, errorCb) {
  const payments = stellarServer.payments().forAccount(accountId);

  const lastToken = lastSavedToken ?
    payments.cursor(lastSavedToken) : payments.cursor('now');

  logger.info('Setting closeStream to teamId: ' + teamId + ', hash: ' + hash);
  authorizations[teamId].subscriptions[hash].closeStream = payments.stream({
    onmessage: function(payment) {
      logger.info('Payment: ' + JSON.stringify(payment, null, 2));

      savePagingToken(payment.paging_token);

      logger.info('payment.to: ' + payment.to + ', accountId: ' + accountId);
      paymentCb(payment);
    },

    onerror: function(error) {
      logger.error('Error in payment stream: ' +
                   JSON.stringify(error, null, 2));
      logger.error('lastToken: ' + lastToken);
      logger.error('accountId: ' + accountId);

      if (error.status === 404) {
        // cancel this stream
        authorizations[teamId].subscriptions[hash].closeStream();

        // delete subscription and notify user
        errorCb(error);
      }
    },
  });
}

function flushStore() {
  fs.writeFile(authorizationsStore, JSON.stringify(authorizations, null, 2),
               (err) => {
                 if (err) throw err;
                 logger.info('Authorizations have been flushed to ' +
                             authorizationsStore);
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

'use strict';

const fs = require('fs');

const bodyParser = require('body-parser');
const express = require('express');
const request = require('request');
const StellarSdk = require('stellar-sdk');
const _ = require('lodash');

const logger = require('./logger');

const slackClientId = process.env.SLACK_CLIENT_ID;
const slackClientSecret = process.env.SLACK_CLIENT_SECRET;

const redirectUri = 'http://stellar-subscribe.creal.de/auth/redirect';
const authorizationsStore = './authorizationsStore';

const app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: true}));

const stellarServer = new StellarSdk.Server('https://horizon.stellar.org');

const server = app.listen(4343, () => {
  logger.info('Listening on port %d in %s mode',
    server.address().port, app.settings.env);
});

const authorizations = fs.existsSync(authorizationsStore) ?
  JSON.parse(fs.readFileSync(authorizationsStore, 'utf-8')) : {};

const txts = {
  cmdNotRecognized: 'Unfortunately I could not recognize your command.\n',
  help: 'Usage:```/stellar subscribe PUBLIC-KEY\n' +
        '/stellar unsubscribe PUBLIC-KEY\n/stellar list```',
};

app.post('/', (req, res) => {
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

    // todo check if already subscribed

    subscription = req.body;
    subscription.postToChannel = req.body.channel_id;
    subscription.channelName = req.body.channel_name;
    subscription.accountId = cmds[1];
    logger.info('new subscription: ' + JSON.stringify(subscription, null, 2));

    if (!authorizations[subscription.team_id].subscriptions) {
      authorizations[subscription.team_id].subscriptions = {};
    }

    hash = subscription.accountId + subscription.postToChannel;
    authorizations[subscription.team_id].subscriptions[hash] = subscription;
    flushStore();
    createStream(subscription.team_id, hash);

    // todo this is a private message to only the user, but it should
    // be publicly stated in the channel that this was set up
    res.send('You will be notified on new payments for `' +
             subscription.accountId + '` in #' +
             subscription.channelName + '.');
    return;

  case 'unsubscribe':
    if (cmds.length !== 2) {
      res.send(txts.cmdNotRecognized + txts.help);
      return;
    }

    teamId = req.body.team_id;
    let channel = req.body.channel_id;
    subscription = req.body;
    let accountId = cmds[1];
    hash = accountId + channel;

    if (!authorizations[teamId].subscriptions[hash]) {
      res.send('You are not subscribed to `' + accountId +
               '` in this channel (#' + req.body.channel_name + ').');
      return;
    }

    authorizations[teamId].subscriptions[hash].closeStream();
    delete authorizations[teamId].subscriptions[hash];
    flushStore();
    res.send('Your subscription of `' + accountId + '` for the channel #' +
             req.body.channel_name + ' was removed.');
    return;

  case 'list':
    teamId = req.body.team_id;
    if (!authorizations[teamId] || !authorizations[teamId].subscriptions) {
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
      list += subscriptions[s].accountId +
              ' to #' + subscriptions[s].channelName + '\n';
    }
    res.send('These are your subscriptions: ' + list + '```');

    break;

  default:
    res.send(txts.cmdNotRecognized + txts.help);
    break;
  }
});

app.get('/', (req, res) =>{
  const uri = 'https://slack.com/oauth/authorize?scope=commands,bot' +
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
      // todo 200?
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

(function load() {
  logger.info('loading ' + _.size(authorizations) + ' authorizations');

  _.forEach(authorizations, (a /*, key */) => {
    _.forEach(a.subscriptions, (subscription, hash) => {
      createStream(a.team_id, hash);
    });
  });
})();

function createStream(teamId, hash) {
  const subscription = authorizations[teamId].subscriptions[hash];
  const accountId = subscription.accountId;
  const token = authorizations[teamId].access_token;

  logger.info('creating stream for ' + accountId +
              ' with token ' + subscription.lastSavedToken);

  const lastToken = subscription.lastSavedToken;
  streamPayments(hash, teamId, accountId, lastToken, function(payment) {
    if (payment.type !== 'payment') {
      return;
    }
    logger.info('payment: ' + JSON.stringify(payment, null, 2));

    const fromWhen = (new Date()).getTime();
    const paymentDate = (new Date(payment.created_at)).getTime();
    if (paymentDate - fromWhen < 0) {
      const diff = paymentDate - fromWhen;
      logger.info('skipping because ' + paymentDate + ' - ' +
                  fromWhen + ' = ' + diff + ' < 0');
      return;
    }

    const asset = payment.asset_type === 'native' ?
      'lumens' : payment.asset_code + ':' + payment.asset_issuer;

    let text = payment.amount + ' ' + asset + ' from `' + payment.from +
               '` to `' + payment.to + '`';

    if (payment.to !== accountId) {
      text = 'You sent: ' + text;
      //post(text, token);
    } else {
      text = 'You received: ' + text;
      post(text, token);
    }
  }, function(token) {
    authorizations[teamId].subscriptions[hash].pagingToken = token;
  }, function(error) {
    delete authorizations[teamId].subscriptions[hash];
    flushStore();
    post('Your subscription of `' + accountId + '` for the channel `' +
         subscription.channelName +
         '` was removed because this error occured: ```' +
         JSON.stringify(error) + '```', token);
  });

  function post(text, token) {
    var data = {
      channel: subscription.postToChannel,
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

    request.post(options, (error /*, response, body */) => {
      // todo error handling
    });
  }
}

function streamPayments(hash, teamId, accountId, lastSavedToken, paymentCb,
  savePagingToken, errorCb) {
  const payments = stellarServer.payments().forAccount(accountId);

  const lastToken = lastSavedToken ?
    payments.cursor(lastSavedToken) : payments.cursor('now');

  logger.info('setting closeStream to teamId: ' + teamId + ', hash: ' + hash);
  authorizations[teamId].subscriptions[hash].closeStream = payments.stream({
    onmessage: function(payment) {
      logger.info('payment: ' + JSON.stringify(payment, null, 2));

      savePagingToken(payment.paging_token);

      logger.info('payment.to: ' + payment.to + ', accountId: ' + accountId);
      paymentCb(payment);
    },

    onerror: function(error) {
      logger.error('Error in payment stream');
      logger.error('error ' + JSON.stringify(error, null, 2));
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
      logger.info('authorizations have been flushed to ' + authorizationsStore);
    });
}

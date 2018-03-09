'use strict';

const fs = require('fs');

const bodyParser = require('body-parser');
const express = require('express');
const request = require('requestretry');
const _ = require('lodash');

const logger = require('../lib/logger');
const notifications = require('../lib/notifications');
exports.notifications = notifications;

const slackClientId = getenv('SLACK_CLIENT_ID');
const slackClientSecret = getenv('SLACK_CLIENT_SECRET');
const slackVerificationToken = getenv('SLACK_VERIFICATION_TOKEN');

const redirectUri = getenv('SERVER_URI') + '/auth/redirect';
logger.info('Using redirectUri ' + redirectUri);

const app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: true}));

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

const cmdNotRecognized = 'Unfortunately I could not recognize your command.\n';
const help =
  'Usage:```/stellar subscribe PUBLIC-KEY\n' +
  '/stellar unsubscribe PUBLIC-KEY\n/stellar list```\n\n' +
  'This Slack App is free software, you can view it\'s source code ' +
  'here: ' +
  'https://github.com/cmichi/stellar-slack-payment-notifications.\n\n' +
  'If you encounter any issues or need support please visit ' +
  'https://github.com/cmichi/stellar-slack-payment-notifications' +
  '#support.';

app.post('/', (req, res) => {
  if (req.body.token !== slackVerificationToken) {
    logger.error('The verification token which was sent (' + req.body.token +
                 ') does not match the verification token of the ' +
                 'Slash command.');
    res.status(403).send('The verification token you sent does not match ' +
                         'the verification token of the Slash command.');
    return;
  }

  let cmds = _.trim(req.body.text).split(' ');
  _.pull(cmds, '');
  if (cmds.length === 0) {
    res.send(help);
    return;
  }

  switch (cmds[0]) {
  case 'subscribe':
    if (cmds.length !== 2) {
      res.send(cmdNotRecognized + help);
      return;
    }

    notifications.subscribe(req, res, cmds);
    break;

  case 'unsubscribe':
    if (cmds.length !== 2) {
      res.send(cmdNotRecognized + help);
      return;
    }

    notifications.unsubscribe(req, res, cmds);
    break;

  case 'list':
    notifications.list(req, res);
    break;

  default:
    res.send(cmdNotRecognized + help);
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
      notifications.authorize(jsonResponse);

      // after the app has been installed we automatically redirect
      // to the users team space
      const uri = 'https://' + team + '.slack.com/';
      res.redirect(301, uri);
    }
  });
});

function getenv(name) {
  if (!process.env[name]) {
    logger.error('The environment variable ' + name + ' is missing!');
    process.exit(1);
  }
  return process.env[name];
}

exports.startStreaming = function() {
  notifications.startStreaming();
};

exports.loadAuthorizations = function() {
  notifications.loadAuthorizations();
};

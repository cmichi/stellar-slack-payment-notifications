'use strict';

const request = require('requestretry');
const _ = require('lodash');

const logger = require('../lib/logger');

function post(receiver, subscription, text, authorizations,
              teamId, successfulCb, revokeCb) {
  var data = {
    channel: receiver,
    text: text,
  };

  const token = authorizations[teamId].access_token;
  var options = {
    url: 'https://slack.com/api/chat.postMessage',
    method: 'POST',
    body: data,
    json: true,
    headers: {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json; charset=utf-8',
    },

    maxAttempts: 5,
    retryDelay: 5000,
    retryStrategy: request.RetryStrategies.HTTPOrNetworkError,
  };

  request.post(options, (error, response, body) => {
    logger.info('Response when posting: ' +
                JSON.stringify(body, null, 2));
    if (error) {
      logger.error('An error occurred when trying to post to ' +
                   'the user: ' + JSON.stringify(error, null, 2) + '. ' +
                   'There were ' + response.attempts + ' retry attempts.\n' +
                   'What was tried to post: ' +
                   JSON.stringify(options, null, 2));
      process.exit(1);
    }

    if (_.get(body, 'ok') === false) {
      logger.error('An error occurred when trying to post to ' +
                   'the user: ' + JSON.stringify(body, null, 2) + '\n' +
                   'The attempted post was: ' +
                   JSON.stringify(options, null, 2));

      if (body.error === 'token_revoked') {
        revokeCb(body);
        return;
      } else {
        logger.error('An unknown error occurred when trying to post to a ' +
                     'channel: ' + JSON.stringify(body, null, 2));
        process.exit(1);
      }
    }

    if (successfulCb) {
      return void successfulCb(null, response, body);
    }
  });
}

exports.postToChannel = function(subscription, text, authorizations,
                                 teamId, successfulCb, revokeCb) {
  const receiver = subscription.channel_id;
  post(receiver, subscription, text, authorizations,
       teamId, successfulCb, revokeCb);
};

exports.postToUser = function(subscription, text, authorizations,
                              teamId, successfulCb, revokeCb) {
  const receiver = subscription.user_id;
  post(receiver, subscription, text, authorizations,
       teamId, successfulCb, revokeCb);
};

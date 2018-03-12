'use strict';

const _ = require('lodash');

const prefixes = [
  'Congratulations:',
  'Good news: ',
  'Something nice just happened: ',
  'Woohoo! ',
  'Positive vibes: ',
  'Great news: ',
  'May this make your day: ',
  'Awesome: ',
  'Happy news: ',
];

function getRandomPrefix() {
  return prefixes[_.random(0, prefixes.length - 1)] + '\n';
}
exports.getRandomPrefix = getRandomPrefix;

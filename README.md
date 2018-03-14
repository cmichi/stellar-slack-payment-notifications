# Stellar Payment Notifications Slack App

[![Build Status](https://travis-ci.org/cmichi/stellar-slack-payment-notifications.svg?branch=master)](https://travis-ci.org/cmichi/stellar-slack-payment-notifications)

![Animation](https://github.com/cmichi/stellar-slack-subscriptions/raw/master/images/animation.gif)

I have built this Slack App for the [Stellar Build Challenge](https://www.stellar.org/lumens/build/)
of March 2018.

[![Add to Slack](https://platform.slack-edge.com/img/add_to_slack.png)](https://slack.com/oauth/authorize?client_id=308656001463.308680541383&scope=commands,chat:write:bot,bot)

[App in the Slack App Directory](https://slack.com/apps/A92L0FXB9-stellar-payment-notifications)


## Privacy Policy

Your Slack user, team id, and channels to which you subscribe are stored in a
private database. They are only used for the purposes of notifying you when
new payments for a Stellar account to which you subscribed happen.
This information is not shared with any third party.


## Support

Please submit [this contact form](http://micha.elmueller.net/contact/) if you
have any remarks, issues, or support requests.


## How to set it up

	$ git clone https://github.com/cmichi/stellar-slack-payment-notifications.git
	$ cd stellar-slack-payment-notifications/
	$ cat > .env
	export SLACK_CLIENT_ID=...
	export SLACK_CLIENT_SECRET=...
	export SLACK_VERIFICATION_TOKEN=...

	export PORT=4343
	export HORIZON_URI=https://horizon.stellar.org
	export SERVER_URI=https://your-server
	export BLOCKCHAIN_EXPLORER=https://stellarchain.io/tx/
	^D
	$ npm install
	$ . .env
	$ npm start


## License

	Copyright (c) 2018

		Michael Mueller <http://micha.elmueller.net/>

	Permission is hereby granted, free of charge, to any person obtaining
	a copy of this software and associated documentation files (the
	"Software"), to deal in the Software without restriction, including
	without limitation the rights to use, copy, modify, merge, publish,
	distribute, sublicense, and/or sell copies of the Software, and to
	permit persons to whom the Software is furnished to do so, subject to
	the following conditions:

	The above copyright notice and this permission notice shall be
	included in all copies or substantial portions of the Software.

	THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
	EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
	MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
	NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
	LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
	OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
	WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

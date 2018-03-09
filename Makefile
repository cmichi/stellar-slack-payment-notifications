SHELL := $(shell which bash)
PATH := $(CURDIR)/node_modules/.bin:$(PATH)
export JSFILES = $(shell find app.js lib/ test/ -name "*.js")

.PHONY: eslint
eslint: node_modules
	./node_modules/.bin/eslint --env mocha $$JSFILES

.PHONY: test
test:
	LOG_LEVEL=CRITICAL node node_modules/.bin/mocha --forbid-only --forbid-pending test/**

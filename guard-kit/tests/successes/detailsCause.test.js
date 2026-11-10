'use strict'

// Tests passing details and cause to options parameter of GuardError

const {SetupError} = require('../../../guard-kit')


throw new SetupError('Test', {details:'Test details', cause:'Test cause'})
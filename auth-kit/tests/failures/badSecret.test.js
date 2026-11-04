'use strict'

// Tests bad auth secrets

const createAuth = require('../../../auth-kit')


// Fails here because of empty string
const auth = createAuth('', {timer:'1h', saltRounds:9})
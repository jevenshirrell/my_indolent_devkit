'use strict'

// Tests invalid input to assert

const {validate, createGuard} = require('../../../guard-kit')


const guard = createGuard()

try {guard.assertSetup(false, 'test')}
catch (err) {console.log(err)}
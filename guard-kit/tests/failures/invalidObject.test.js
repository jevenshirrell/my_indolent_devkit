'use strict'

// Tests invalid input to validateObject

const {validate, createGuard} = require('../../../guard-kit')


const guard = createGuard()

try {guard.validateObject({one:1, two:2}, validate.integer, {setup:true})}
catch (err) {console.log(err)}
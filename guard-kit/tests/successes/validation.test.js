'use strict'

// Tests custom input validation functions

const {validate, oneOf, optional, createGuard} = require('../../../guard-kit')


const guard = createGuard('test')

try {guard.assertSetup(validate.nonEmptyArray({}))}
catch (err) {console.log(err)}

try {guard.expect('maybe', 'test 1', oneOf(['yes', 'no']), {setup:true})}
catch (err) {console.log(err)}

try {guard.expect({}, 'test 2', optional(validate.function))}
catch (err) {console.log(err)}

try {guard.validateObject({one:1, two:'2'}, {one: oneOf([1, 2]), two: validate.integer}, {setup:true})}
catch (err) {console.log(err)}
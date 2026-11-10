'use strict'

// Tests isApiError function

const {ApiError, SetupError, isApiError} = require('../../../guard-kit')


console.log(isApiError(new ApiError(200, 'Test')))
console.log(isApiError(new SetupError('Test 2')))
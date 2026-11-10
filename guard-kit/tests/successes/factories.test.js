'use strict'

// Tests the premade errors in ApiError

const {ApiError} = require('../../../guard-kit')


try {throw ApiError.badRequest()}
catch (err) {console.log(err)}

try {throw ApiError.unauthorized()}
catch (err) {console.log(err)}

try {throw ApiError.forbidden()}
catch (err) {console.log(err)}

try {throw ApiError.notFound()}
catch (err) {console.log(err)}

try {throw ApiError.conflict()}
catch (err) {console.log(err)}
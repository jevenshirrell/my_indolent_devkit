'use strict'

// Tests the response envelope structure

const {sendSuccess, sendCreated, sendNoContent} = require('../../../api-kit')
const {createFakeRes} = require('../fakeRes.js')


sendSuccess(createFakeRes(), {name:'Test', age:100})
sendCreated(createFakeRes(), {name:'Test', age:100})
sendNoContent(createFakeRes())
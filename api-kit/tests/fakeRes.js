'use strict'

function createFakeRes({ log = true } = {}) {
    const res = {
        statusCode: undefined,
        body: undefined,
        sentArgs: undefined,
        jsonCalled: false,
        sendCalled: false,

        status(code) {
            res.statusCode = code
            return res
        },
        json(body) {
            res.jsonCalled = true
            res.body = body
            if (log) console.log(`${res.statusCode}:`, body)
            return res
        },
        send(...args) {
            res.sendCalled = true
            res.sentArgs = args
            if (log) console.log(`${res.statusCode}:`, args)
            return res
        },
    }
    return res
}

module.exports = { createFakeRes }
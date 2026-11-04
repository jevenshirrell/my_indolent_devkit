'use strict'

// Tests MongoDB connection/disconnection
// REMINDER: run with --env-file=.env argument or pass your own URI

const {connectDatabase, isConnected, disconnectDatabase} = require('../../../db-kit')


connectDatabase(process.env.MONGO_URI).then(() => console.log(isConnected())).then(() => disconnectDatabase())
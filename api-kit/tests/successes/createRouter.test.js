'use strict'

// Tests the basic router creation
// REMINDER: run with --env-file=.env argument or pass your own URI

const express = require('express')

const {buildRouter} = require('../../../api-kit')


const app = express()

let db = []

const controller = {}
const router = buildRouter()

app.use(express.json())
app.use(router)
app.listen(3000, () => console.log(`Listening on http://localhost:${3000}`))

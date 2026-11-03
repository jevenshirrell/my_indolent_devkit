'use-strict'

// Tests verifying an invalid token

const jwt = require('jsonwebtoken')
const createAuth = require('../../../auth-kit')


const auth = createAuth('secret', {timer:'1h', saltRounds:9})

let user = {
    name:'test',
    id:'12345'
}
let token = jwt.sign(user, 'badSecret')

// Fails here with invalid token
console.log(auth.verifyToken(token))
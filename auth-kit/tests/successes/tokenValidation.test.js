'use strict'

// Tests signing and verifying a user token

const createAuth = require('../../../auth-kit')


const auth = createAuth('secret', {timer:'1h', saltRounds:9})

let user = {
    name:'test',
    id:'12345'
}
let token = auth.signToken(user)

console.log(auth.verifyToken(token))
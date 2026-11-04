'use strict'

// Tests rehashing old passwords

const bcrypt = require('bcryptjs')
const createAuth = require('../../../auth-kit')


const auth = createAuth('secret', {timer:'1h', saltRounds:9})

let hash = bcrypt.hashSync('password', 10)

console.log(auth.needsRehash(hash))
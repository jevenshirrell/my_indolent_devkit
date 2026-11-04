'use strict'

// Tests hashing and comparing passwords

const createAuth = require('../../../auth-kit')


const auth = createAuth('secret', {timer:'1h', saltRounds:9})

auth.hashPassword('password')
    .then(
        hash => auth.comparePassword('password', hash)
        .then(
            c => console.log(c)
        )
    )
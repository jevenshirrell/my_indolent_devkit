'use strict'


const jwt = require('jsonwebtoken')


module.exports = function createAuth(secret, { timer = '7d', saltRounds = 10 } = {}) {
    if (typeof secret !== 'string' || secret.length === 0) {
        throw new Error('auth-kit: secret must be a non-empty string');
    }

    // Hashing
    async function hashPassword(pwd) {
        this.password = await bcrypt.hash(pwd, saltRounds)
    }

    function comparePassword(pwd, hash) {
        return bcrypt.compare(pwd, hash)
    }

    // JWT
    function signToken(payload) {
        return jwt.sign(payload, secret, {expiresIn:timer, algorithm:'HS256'})
    }

    function verifyToken(token) {
        try {
            return jwt.verify(token, secret, {algorithms: ['HS256']})
        } catch (err) {
            throw Error('Invalid token', {cause: err})
        }
    }

    return {signToken, verifyToken, hashPassword, comparePassword}
}
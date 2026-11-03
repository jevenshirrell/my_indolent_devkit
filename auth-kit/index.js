'use strict'


const jwt = require('jsonwebtoken')
const bcrypt = require('bcryptjs')


module.exports = function createAuth(secret, { timer = '7d', saltRounds = 10 } = {}) {
    if (typeof secret !== 'string' || secret.length === 0) {
        throw new Error('auth-kit: secret must be a non-empty string');
    }

    // Hashing
    async function hashPassword(pwd) {
        return await bcrypt.hash(pwd, saltRounds)
    }
    function comparePassword(pwd, hash) {
        return bcrypt.compare(pwd, hash)
    }
    function needsRehash(hash) {
        return bcrypt.getRounds(hash) !== saltRounds
    }

    // JWT
    function signToken(payload) {
        return jwt.sign(payload, secret, {expiresIn:timer, algorithm:'HS256'})
    }
    function verifyToken(token) {
        try {
            return jwt.verify(token, secret, {algorithms: ['HS256']})
        } catch (err) {
            throw new Error('Invalid token', {cause: err})
        }
    }

    // Storage
    function createTokenStorage({ storage = globalThis.localStorage, key = 'userToken' } = {}) {
        if (!storage) throw new Error('auth-kit: no storage')
        return {
            setToken: (tok) => storage.setItem(key, tok),
            getToken: () => storage.getItem(key),
            clearToken: () => storage.removeItem(key),
        }
    }

    return {signToken, verifyToken, hashPassword, comparePassword, needsRehash, createTokenStorage}
}
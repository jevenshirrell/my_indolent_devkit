'use strict'


const jwt = require('jsonwebtoken')
const bcrypt = require('bcryptjs')
const {validate, oneOf, optional, startsWith, createGuard, ApiError, SetupError} = require('../guard-kit')


const guard = createGuard('auth-kit')

module.exports = function createAuth(secret, { timer = '7d', saltRounds = 10 } = {}) {
    guard.expect(secret, 'secret', validate.nonEmptyString, {setup:true})

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
            throw ApiError.unauthorized('Invalid token', {cause: err})
        }
    }

    // Storage
    function createTokenStorage({ storage = globalThis.localStorage, key = 'userToken' } = {}) {
        if (!storage) throw new SetupError('auth-kit: no storage')
        return {
            setToken: (tok) => storage.setItem(key, tok),
            getToken: () => storage.getItem(key),
            clearToken: () => storage.removeItem(key),
        }
    }

    return {signToken, verifyToken, hashPassword, comparePassword, needsRehash, createTokenStorage}
}
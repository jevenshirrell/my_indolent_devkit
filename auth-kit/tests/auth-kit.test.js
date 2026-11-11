'use strict'

// auth-kit tests (Node's built-in test runner)
// Run on their own with: node --test auth-kit/tests/auth-kit.test.js

const {describe, test} = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const jwt = require('jsonwebtoken')
const bcrypt = require('bcryptjs')

const createAuth = require('..')
const {ApiError, SetupError, isApiError} = require('../../guard-kit')


const source = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8')

// low cost so hashing stays fast in tests
const auth = createAuth('test-secret', {timer: '1h', saltRounds: 4})

// a fake storage that stands in for the browser's localStorage
function fakeStorage() {
    const store = new Map()
    return {
        store,
        getItem: (key) => (store.has(key) ? store.get(key) : null),
        setItem: (key, value) => store.set(key, value),
        removeItem: (key) => store.delete(key)
    }
}


describe('auth-kit: success cases', () => {
    test('a password hashes and compares correctly', async () => {
        const hash = await auth.hashPassword('hunter2')

        assert.notEqual(hash, 'hunter2')
        assert.equal(await auth.comparePassword('hunter2', hash), true)
        assert.equal(await auth.comparePassword('wrong', hash), false)
    })

    test('hashing the same password twice gives different hashes', async () => {
        const [first, second] = await Promise.all([auth.hashPassword('same'), auth.hashPassword('same')])

        assert.notEqual(first, second)
    })

    test('needsRehash flags a hash whose cost differs from saltRounds', async () => {
        // bcryptjs does not allow a cost below 4, so the current setting is 5
        const picky = createAuth('test-secret', {saltRounds: 5})
        const current = await picky.hashPassword('pw')
        const older = bcrypt.hashSync('pw', 4)
        const newer = bcrypt.hashSync('pw', 6)

        assert.equal(picky.needsRehash(current), false)
        assert.equal(picky.needsRehash(older), true)
        // the check is "different from", not "lower than", so a higher cost is flagged too
        assert.equal(picky.needsRehash(newer), true)
    })

    test('a signed token verifies and keeps the caller\'s payload', () => {
        const token = auth.signToken({sub: 'user-123', role: 'admin'})
        const decoded = auth.verifyToken(token)

        assert.equal(decoded.sub, 'user-123')
        assert.equal(decoded.role, 'admin')
        assert.equal(typeof decoded.iat, 'number')
        assert.equal(decoded.exp - decoded.iat, 3600)
    })

    test('token storage sets, gets and clears a token', () => {
        const storage = fakeStorage()
        const tokens = auth.createTokenStorage({storage})

        assert.equal(tokens.getToken(), null)
        tokens.setToken('abc')
        assert.equal(tokens.getToken(), 'abc')
        tokens.clearToken()
        assert.equal(tokens.getToken(), null)
    })

    test('token storage saves under a custom key when one is given', () => {
        const storage = fakeStorage()
        auth.createTokenStorage({storage, key: 'session'}).setToken('abc')

        assert.deepEqual([...storage.store.entries()], [['session', 'abc']])
    })
})


describe('auth-kit: failure cases', () => {
    test('createAuth rejects a missing or non-string secret', () => {
        for (const bad of ['', undefined, null, 123, {}]) {
            assert.throws(
                () => createAuth(bad),
                (err) => err instanceof SetupError && /auth-kit: secret must be a non-empty string/.test(err.message),
                `secret ${String(bad)}`
            )
        }
    })

    test('a token signed with a different secret is rejected as a 401 with the cause kept', () => {
        const forged = jwt.sign({sub: 'user-123'}, 'some-other-secret')

        assert.throws(
            () => auth.verifyToken(forged),
            (err) => {
                assert.ok(isApiError(err))
                assert.equal(err.statusCode, 401)
                assert.equal(err.message, 'Invalid token')
                assert.equal(err.cause.name, 'JsonWebTokenError')
                return true
            }
        )
    })

    test('an expired token is rejected as a 401', () => {
        const expired = jwt.sign({sub: 'user-123'}, 'test-secret', {expiresIn: -10})

        assert.throws(
            () => auth.verifyToken(expired),
            (err) => isApiError(err) && err.statusCode === 401 && err.cause.name === 'TokenExpiredError'
        )
    })

    test('garbage that is not a token is rejected as a 401', () => {
        for (const bad of ['not.a.token', 'x', '', undefined, null, 42]) {
            assert.throws(() => auth.verifyToken(bad), (err) => isApiError(err) && err.statusCode === 401, `token ${String(bad)}`)
        }
    })

    test('a token signed with another algorithm is rejected, even with the right secret', () => {
        const hs512 = jwt.sign({sub: 'user-123'}, 'test-secret', {algorithm: 'HS512'})

        assert.throws(() => auth.verifyToken(hs512), (err) => isApiError(err) && err.statusCode === 401)
    })

    test('token storage with no storage available is a SetupError', () => {
        // passing null on purpose: Node may or may not have a global localStorage
        assert.throws(
            () => auth.createTokenStorage({storage: null}),
            (err) => err instanceof SetupError && err.message === 'auth-kit: no storage'
        )
    })

    test('bad hashes: compare says false, needsRehash says true, and non-strings are rejected', async () => {
        assert.equal(await auth.comparePassword('pw', 'not-a-hash'), false)
        assert.equal(auth.needsRehash('not-a-hash'), true)

        // passwords and hashes are not validated here; bcryptjs rejects what it cannot handle
        await assert.rejects(() => auth.hashPassword(undefined), Error)
        assert.throws(() => auth.needsRehash(undefined), Error)
    })
})


describe('auth-kit: contract', () => {
    test('createAuth returns exactly the functions the README lists', () => {
        assert.deepEqual(Object.keys(auth).sort(), [
            'comparePassword', 'createTokenStorage', 'hashPassword', 'needsRehash', 'signToken', 'verifyToken'
        ])
    })

    test('defaults match the README: 7 day tokens and the userToken storage key', () => {
        const defaults = createAuth('test-secret')
        const decoded = defaults.verifyToken(defaults.signToken({sub: 'a'}))
        assert.equal(decoded.exp - decoded.iat, 7 * 24 * 60 * 60)

        const storage = fakeStorage()
        defaults.createTokenStorage({storage}).setToken('abc')
        assert.deepEqual([...storage.store.keys()], ['userToken'])
    })

    test('the secret is a constructor argument, so two instances with different secrets do not trust each other', () => {
        const other = createAuth('a-different-secret')

        assert.throws(() => other.verifyToken(auth.signToken({sub: 'a'})), (err) => isApiError(err) && err.statusCode === 401)
    })

    test('depends only on its libraries and guard-kit, and does not read the environment', () => {
        const requires = [...source.matchAll(/require\(['"]([^'"]+)['"]\)/g)].map((match) => match[1]).sort()

        assert.deepEqual(requires, ['../guard-kit', 'bcryptjs', 'jsonwebtoken'])
        assert.ok(!/process\.env/.test(source))
    })
})

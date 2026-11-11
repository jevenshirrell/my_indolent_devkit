'use strict'

// guard-kit tests (Node's built-in test runner)
// Run on their own with: node --test guard-kit/tests/guard-kit.test.js

const {describe, test} = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const {
    GuardError, ApiError, SetupError, isApiError,
    rule, validate, oneOf, optional, startsWith, createGuard,
    describe: describeValue
} = require('..')


const source = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8')


describe('guard-kit: success cases', () => {
    test('ApiError factories set the status, default message and flags', () => {
        const factories = [
            ['badRequest', 400, 'Bad Request'],
            ['unauthorized', 401, 'Unauthorized'],
            ['forbidden', 403, 'Forbidden'],
            ['notFound', 404, 'Not Found'],
            ['conflict', 409, 'Conflict']
        ]

        for (const [name, status, message] of factories) {
            const err = ApiError[name]()
            assert.equal(err.statusCode, status, `${name} status`)
            assert.equal(err.message, message, `${name} message`)
            assert.equal(err.name, 'ApiError')
            assert.equal(err.details, null)
            assert.equal(err.isOperational, true)
            assert.ok(err instanceof Error && err instanceof GuardError && err instanceof ApiError)
            assert.ok(!(err instanceof SetupError))
        }
    })

    test('ApiError keeps details and cause when they are given', () => {
        const cause = new Error('E11000 duplicate key')
        const err = ApiError.conflict('Email already used', {details: {field: 'email'}, cause})

        assert.equal(err.message, 'Email already used')
        assert.deepEqual(err.details, {field: 'email'})
        assert.equal(err.cause, cause)
    })

    test('SetupError carries details and cause but has no status code', () => {
        const err = new SetupError('bad setup', {details: 'some details', cause: 'some cause'})

        assert.equal(err.name, 'SetupError')
        assert.equal(err.details, 'some details')
        assert.equal(err.cause, 'some cause')
        assert.equal(err.isOperational, false)
        assert.equal(err.statusCode, undefined)
        assert.ok(err instanceof GuardError)
    })

    test('isApiError is true only for request-time errors', () => {
        assert.equal(isApiError(ApiError.notFound()), true)
        assert.equal(isApiError(new ApiError(200, 'any integer status counts')), true)
        assert.equal(isApiError(new SetupError('setup')), false)
        assert.equal(isApiError(new Error('plain')), false)
        assert.equal(isApiError(null), false)
        assert.equal(isApiError(undefined), false)
        // it checks the shape, not instanceof, so a second loaded copy of guard-kit still works
        assert.equal(isApiError({name: 'ApiError', isOperational: true, statusCode: 404}), true)
    })

    test('validate rules accept good values and reject bad ones', () => {
        const cases = [
            ['nonEmptyString', ['a', ' '], ['', 5, null, undefined]],
            ['string', ['a', ''], [5, null, undefined, []]],
            ['function', [() => {}, Math.max], ['fn', {}, null]],
            ['array', [[], [1]], ['[]', {}, null]],
            ['nonEmptyArray', [[1], ['a', 'b']], [[], {}, 'a']],
            ['object', [{}, {a: 1}], [null, [], 'a', 5, () => {}]],
            ['integer', [0, -3, 42], [1.5, '1', NaN, null]],
            ['positiveInteger', [1, 42], [0, -1, 1.5, '1']]
        ]

        for (const [name, good, bad] of cases) {
            for (const value of good) assert.equal(validate[name](value), true, `${name} should accept ${String(value)}`)
            for (const value of bad) assert.equal(validate[name](value), false, `${name} should reject ${String(value)}`)
        }
    })

    test('oneOf, optional and startsWith build rules with labels', () => {
        const method = oneOf(['get', 'post'])
        assert.equal(method('get'), true)
        assert.equal(method('put'), false)
        assert.equal(method.label, 'one of: get, post')

        const maybeFn = optional(validate.function)
        assert.equal(maybeFn(undefined), true)
        assert.equal(maybeFn(() => {}), true)
        assert.equal(maybeFn('x'), false)
        assert.equal(maybeFn(null), false)
        assert.equal(maybeFn.label, 'a function, or omitted')

        const slash = startsWith('/')
        assert.equal(slash('/items'), true)
        assert.equal(slash('items'), false)
        assert.equal(slash(''), false)
        assert.equal(slash(5), false)
        assert.equal(slash.label, "a string starting with '/'")
    })

    test('rule attaches a label to a function and returns the same function', () => {
        const isEven = (v) => v % 2 === 0
        const labelled = rule('an even number', isEven)

        assert.equal(labelled, isEven)
        assert.equal(labelled.label, 'an even number')
    })

    test('describe names what a value is, for error messages', () => {
        assert.equal(describeValue(null), 'null')
        assert.equal(describeValue(''), 'an empty string')
        assert.equal(describeValue([]), 'an array')
        assert.equal(describeValue(5), 'number')
        assert.equal(describeValue(undefined), 'undefined')
        assert.equal(describeValue({}), 'object')
    })

    test('a guard stays quiet when the input is valid', () => {
        const guard = createGuard('test')

        assert.doesNotThrow(() => guard.assert(true, 'unused'))
        assert.doesNotThrow(() => guard.assertSetup(true, 'unused'))
        assert.doesNotThrow(() => guard.expect('s3cret', 'secret', validate.nonEmptyString, {setup: true}))
        assert.doesNotThrow(() => guard.expect(undefined, 'auth', optional(validate.function)))
        assert.doesNotThrow(() =>
            guard.validateObject({one: 1, two: 2}, {one: oneOf([1, 2]), two: validate.integer}, {setup: true})
        )
    })
})


describe('guard-kit: failure cases', () => {
    const guard = createGuard('test')

    test('assert(false) throws a 400 ApiError that keeps the details', () => {
        assert.throws(
            () => guard.assert(false, 'Email is invalid', {email: 'not an address'}),
            (err) => {
                assert.ok(isApiError(err))
                assert.equal(err.statusCode, 400)
                assert.equal(err.message, 'test: Email is invalid')
                assert.deepEqual(err.details, {email: 'not an address'})
                return true
            }
        )
    })

    test('assertSetup(false) throws a SetupError, and a guard without a prefix adds none', () => {
        assert.throws(
            () => guard.assertSetup(false, 'secret missing'),
            (err) => {
                assert.ok(err instanceof SetupError)
                assert.ok(!isApiError(err))
                assert.equal(err.isOperational, false)
                assert.equal(err.message, 'test: secret missing')
                return true
            }
        )

        assert.throws(() => createGuard().assertSetup(false, 'plain'), {name: 'SetupError', message: 'plain'})
    })

    test('expect names the value and what it got, as a SetupError or a 400', () => {
        assert.throws(
            () => guard.expect('', 'secret', validate.nonEmptyString, {setup: true}),
            {name: 'SetupError', message: 'test: secret must be a non-empty string (got an empty string)'}
        )
        assert.throws(
            () => guard.expect(null, 'routes', validate.nonEmptyArray, {setup: true}),
            {name: 'SetupError', message: 'test: routes must be a non-empty array (got null)'}
        )
        assert.throws(
            () => guard.expect(5, 'name', validate.nonEmptyString),
            (err) => isApiError(err) && err.statusCode === 400 && err.message === 'test: name must be a non-empty string (got number)'
        )
    })

    test('validateObject reports every problem together as a 400 with details', () => {
        assert.throws(
            () => guard.validateObject({two: '2'}, {one: oneOf([1, 2]), two: validate.integer}),
            (err) => {
                assert.ok(isApiError(err))
                assert.equal(err.statusCode, 400)
                assert.equal(err.message, 'test: Validation failed')
                assert.deepEqual(err.details, {
                    one: 'must be one of: 1, 2 (got undefined)',
                    two: 'must be an integer (got string)'
                })
                return true
            }
        )
    })

    test('validateObject in setup mode throws a SetupError whose message lists every problem', () => {
        assert.throws(
            () => guard.validateObject({two: '2'}, {one: oneOf([1, 2]), two: validate.integer}, {setup: true}),
            (err) => {
                assert.ok(err instanceof SetupError)
                assert.equal(err.message, 'test: one must be one of: 1, 2 (got undefined); two must be an integer (got string)')
                assert.deepEqual(Object.keys(err.details), ['one', 'two'])
                return true
            }
        )
    })

    test('validateObject with a value or rules that is not an object is always a SetupError', () => {
        const cases = [
            ['value is undefined', () => guard.validateObject(undefined, {a: validate.string})],
            ['value is an array', () => guard.validateObject([], {a: validate.string})],
            ['rules is a function', () => guard.validateObject({one: 1}, validate.integer)],
            ['rules is null', () => guard.validateObject({one: 1}, null)]
        ]

        for (const [label, call] of cases) {
            assert.throws(call, (err) => err instanceof SetupError && !isApiError(err), label)
        }
    })

    test('an ApiError needs an integer status code', () => {
        for (const bad of ['404', 1.5, undefined, null, NaN]) {
            assert.throws(
                () => new ApiError(bad, 'message'),
                (err) => err instanceof SetupError && /guard-kit: statusCode must be an integer/.test(err.message),
                `status ${String(bad)}`
            )
        }
    })
})


describe('guard-kit: contract', () => {
    test('exports exactly what the README lists', () => {
        const exported = Object.keys(require('..')).sort()

        assert.deepEqual(exported, [
            'ApiError', 'GuardError', 'SetupError', 'createGuard', 'describe',
            'isApiError', 'oneOf', 'optional', 'rule', 'startsWith', 'validate'
        ])
    })

    test('validate holds the eight rules the README lists', () => {
        assert.deepEqual(Object.keys(validate).sort(), [
            'array', 'function', 'integer', 'nonEmptyArray', 'nonEmptyString', 'object', 'positiveInteger', 'string'
        ])
    })

    test('createGuard returns the four checks, and the factories are all there', () => {
        assert.deepEqual(Object.keys(createGuard('x')).sort(), ['assert', 'assertSetup', 'expect', 'validateObject'])

        for (const name of ['badRequest', 'unauthorized', 'forbidden', 'notFound', 'conflict']) {
            assert.equal(typeof ApiError[name], 'function', name)
        }
    })

    test('has no outward dependencies and does not read the environment', () => {
        const requires = [...source.matchAll(/require\(['"]([^'"]+)['"]\)/g)].map((match) => match[1])

        assert.deepEqual(requires, [])
        assert.ok(!/process\.env/.test(source))
    })
})

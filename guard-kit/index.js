'use strict'


// Taxonomy
class GuardError extends Error {
    constructor(message, { details = null, cause } = {}) {
        super(message, { cause })
        this.name = this.constructor.name
        this.details = details
        Error.captureStackTrace(this, this.constructor)
    }
}

class ApiError extends GuardError {
    isOperational = true
 
    constructor(statusCode, message, options) {
        if (!Number.isInteger(statusCode)) {
            throw new SetupError(`guard-kit: statusCode must be an integer (got ${statusCode})`)
        }
        super(message, options)
        this.statusCode = statusCode
    }
 
    // 400: malformed or invalid input
    static badRequest(message = 'Bad Request', options) { return new ApiError(400, message, options) }
    // 401: not logged in, or bad credentials or token
    static unauthorized(message = 'Unauthorized', options) { return new ApiError(401, message, options) }
    // 403: logged in, but not allowed
    static forbidden(message = 'Forbidden', options) { return new ApiError(403, message, options) }
    // 404: the resource does not exist
    static notFound(message = 'Not Found', options) { return new ApiError(404, message, options) }
    // 409: valid request that conflicts with the current state (e.g. duplicate record)
    static conflict(message = 'Conflict', options) { return new ApiError(409, message, options) }
}


class SetupError extends GuardError {
  isOperational = false
}

function isApiError(err) {
    return Boolean(err) && err.name === 'ApiError' && err.isOperational === true && Number.isInteger(err.statusCode)
}

// Validation
function rule(label, fn) {
    fn.label = label
    return fn
}
 
const validate = {
    nonEmptyString: rule('a non-empty string', (v) => typeof v === 'string' && v.length > 0),
    string: rule('a string', (v) => typeof v === 'string'),
    function: rule('a function', (v) => typeof v === 'function'),
    array: rule('an array', (v) => Array.isArray(v)),
    nonEmptyArray: rule('a non-empty array', (v) => Array.isArray(v) && v.length > 0),
    object: rule('a plain object', (v) => typeof v === 'object' && v !== null && !Array.isArray(v)),
    integer: rule('an integer', (v) => Number.isInteger(v)),
    positiveInteger: rule('a positive integer', (v) => Number.isInteger(v) && v > 0)
}
 
function oneOf(list) {
    return rule(`one of: ${list.join(', ')}`, (v) => list.includes(v))
}
 
function optional(inner) {
    return rule(`${inner.label}, or omitted`, (v) => v === undefined || inner(v))
}
 
function describe(value) {
    if (value === null) return 'null'
    if (value === '') return 'an empty string'
    if (Array.isArray(value)) return 'an array'
    return typeof value
}

function createGuard(prefix = '') {
    const say = (message) => (prefix ? `${prefix}: ${message}` : message)
 
    function fail(message, setup, details = null) {
        if (setup) throw new SetupError(say(message), { details })
        throw ApiError.badRequest(say(message), { details })
    }
 
    function assert(condition, message, details) {
        if (!condition) fail(message, false, details)
    }
 
    function assertSetup(condition, message) {
        if (!condition) fail(message, true)
    }
 
    function expect(value, name, check, { setup = false } = {}) {
        if (!check(value)) fail(`${name} must be ${check.label} (got ${describe(value)})`, setup)
    }
 
    function validateObject(value, rules, { setup = false } = {}) {
        expect(value, 'value', validate.object, {setup:true})
        expect(rules, 'rules', validate.object, {setup:true})

        const problems = {}
        for (const [field, check] of Object.entries(rules)) {
            if (!check(value[field])) problems[field] = `must be ${check.label} (got ${describe(value[field])})`
        }
        if (Object.keys(problems).length === 0) return

        const summary = Object.entries(problems).map(([field, text]) => `${field} ${text}`).join('; ')
        fail(setup ? summary : 'Validation failed', setup, problems)
    }
 
    return { assert, assertSetup, expect, validateObject }
}


module.exports = {GuardError, ApiError, SetupError, isApiError, validate, oneOf, optional, createGuard}
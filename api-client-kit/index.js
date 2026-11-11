'use strict'


const {ApiError, validate, oneOf, optional, startsWith, createGuard} = require('../guard-kit')


const guard = createGuard('api-client')

// Helpers
function buildUrl(root, path, query) {
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== null) params.append(key, String(value))
    }
    const qs = params.toString()
    return `${root}${path}${qs ? `?${qs}` : ''}`
}

async function readBody(res) {
    const text = await res.text()
    if (!text) return null
    try {
        return JSON.parse(text)
    } catch {
        return text
    }
}

function toApiError(res, body) {
    const envelope = validate.object(body)
    const message = envelope && typeof body.error === 'string' ? body.error : (res.statusText || `HTTP ${res.status}`)
    return new ApiError(res.status, message, {details: envelope && 'details' in body ? body.details : null})
}

// Client
function createClient(baseUrl, {getToken, headers = {}, timeout = 10000} = {}) {
    // validate param input
    guard.expect(baseUrl, 'baseUrl', validate.nonEmptyString, {setup:true})
    guard.expect(getToken, 'getToken', optional(validate.function), {setup:true})
    guard.expect(headers, 'headers', validate.object, {setup:true})
    guard.expect(timeout, 'timeout', validate.positiveInteger, {setup:true})

    const root = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl

    async function request(method, path, {body, query = {}, headers: extraHeaders = {}} = {}) {
        const verb = typeof method === 'string' ? method.toLowerCase() : method

        // validate request input
        guard.validateObject(
            {method:verb, path},
            {
                method:oneOf(['get', 'post', 'put', 'patch', 'delete']),
                path:startsWith('/'),
            },
            {setup:true}
        )
        guard.expect(query, 'query', validate.object, {setup:true})
        guard.expect(extraHeaders, 'headers', validate.object, {setup:true})
        guard.assertSetup(!(verb === 'get' && body !== undefined), 'get requests cannot have a body')

        // build request
        const reqHeaders = {Accept:'application/json', ...headers}
        const token = getToken ? await getToken() : null
        if (token) reqHeaders.Authorization = `Bearer ${token}`

        const init = {method:verb.toUpperCase()}
        if (body !== undefined) {
            init.body = JSON.stringify(body)
            reqHeaders['Content-Type'] = 'application/json'
        }
        init.headers = {...reqHeaders, ...extraHeaders}

        const abort = new AbortController()
        let timedOut = false
        const timer = setTimeout(() => {
            timedOut = true
            abort.abort()
        }, timeout)

        let res, parsed
        try {
            res = await fetch(buildUrl(root, path, query), {...init, signal:abort.signal})
            parsed = await readBody(res)
        } catch (err) {
            const reason = timedOut ? `request timed out after ${timeout}ms` : `network error (${err.message})`
            throw new ApiError(0, `api-client: ${reason}`, {cause:err})
        } finally {
            clearTimeout(timer)
        }

        if (!res.ok) throw toApiError(res, parsed)
        return parsed
    }

    return {
        request,
        get: (path, options) => request('get', path, options),
        post: (path, body, options) => request('post', path, {...options, body}),
        put: (path, body, options) => request('put', path, {...options, body}),
        patch: (path, body, options) => request('patch', path, {...options, body}),
        delete: (path, options) => request('delete', path, options)
    }
}

module.exports = createClient
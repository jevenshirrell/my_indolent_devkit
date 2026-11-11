'use strict'

// api-client-kit tests (Node's built-in test runner)
// Run on their own with: node --test api-client-kit/tests/api-client-kit.test.js
// A small Express server starts on a free port for the tests, so no setup or network is needed.

const {describe, test, before, after} = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const express = require('express')

const createClient = require('..')
const {ApiError, SetupError, isApiError} = require('../../guard-kit')


const source = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8')

let server
let baseUrl

before(async () => {
    const app = express()
    app.use(express.json())

    // echoes what the server received, so tests can check the URL, headers and body
    app.all('/echo{/*rest}', (req, res) => {
        res.json({
            method: req.method,
            path: req.path,
            query: req.query,
            body: req.body ?? null,
            headers: {
                authorization: req.get('authorization') ?? null,
                contentType: req.get('content-type') ?? null,
                accept: req.get('accept') ?? null,
                custom: req.get('x-custom') ?? null
            }
        })
    })
    app.get('/empty', (req, res) => res.status(204).end())
    app.get('/text', (req, res) => res.type('text/plain').send('plain words'))
    app.get('/missing', (req, res) => res.status(404).json({success: false, error: 'Item not found', details: {id: '9'}}))
    app.get('/boom', (req, res) => res.status(500).type('text/plain').send('upstream exploded'))
    app.get('/slow', (req, res) => setTimeout(() => res.json({late: true}), 500))

    await new Promise((resolve) => { server = app.listen(0, resolve) })
    baseUrl = `http://127.0.0.1:${server.address().port}`
})

after(async () => {
    await new Promise((resolve) => {
        server.close(resolve)
        server.closeAllConnections()
    })
})

// calls the client and hands back the error it threw, or fails if it did not throw
async function failure(call) {
    try {
        await call()
    } catch (err) {
        return err
    }
    throw new Error('expected the call to throw, but it succeeded')
}


describe('api-client-kit: success cases', () => {
    test('get returns the parsed body, adds the query string and skips null and undefined values', async () => {
        const api = createClient(baseUrl)
        const res = await api.get('/echo/items', {query: {page: 2, tag: 'a b', skip: null, none: undefined}})

        assert.equal(res.method, 'GET')
        assert.equal(res.path, '/echo/items')
        assert.deepEqual(res.query, {page: '2', tag: 'a b'})
    })

    test('a trailing slash on the base URL is ignored', async () => {
        const res = await createClient(`${baseUrl}/`).get('/echo/items')

        assert.equal(res.path, '/echo/items')
    })

    test('post, put and patch send the body as JSON', async () => {
        const api = createClient(baseUrl)

        for (const method of ['post', 'put', 'patch']) {
            const res = await api[method]('/echo/items', {name: 'fern'})

            assert.equal(res.method, method.toUpperCase())
            assert.deepEqual(res.body, {name: 'fern'})
            assert.equal(res.headers.contentType, 'application/json')
        }
    })

    test('delete and request cover the remaining methods, and the method name is not case sensitive', async () => {
        const api = createClient(baseUrl)

        assert.equal((await api.delete('/echo/items/1')).method, 'DELETE')
        assert.equal((await api.request('PATCH', '/echo/items/1', {body: {a: 1}})).method, 'PATCH')
        assert.equal((await api.request('get', '/echo/items')).method, 'GET')
    })

    test('getToken adds a Bearer header, and it can be sync or async', async () => {
        const sync = await createClient(baseUrl, {getToken: () => 'abc'}).get('/echo/x')
        const async_ = await createClient(baseUrl, {getToken: async () => 'xyz'}).get('/echo/x')

        assert.equal(sync.headers.authorization, 'Bearer abc')
        assert.equal(async_.headers.authorization, 'Bearer xyz')
    })

    test('no header is sent when there is no getToken or it returns nothing', async () => {
        const none = await createClient(baseUrl).get('/echo/x')
        const empty = await createClient(baseUrl, {getToken: () => null}).get('/echo/x')

        assert.equal(none.headers.authorization, null)
        assert.equal(empty.headers.authorization, null)
    })

    test('default headers apply to every request and a request\'s own headers override them', async () => {
        const api = createClient(baseUrl, {headers: {'X-Custom': 'default'}, getToken: () => 'abc'})

        const plain = await api.get('/echo/x')
        assert.equal(plain.headers.custom, 'default')
        assert.equal(plain.headers.accept, 'application/json')

        const overridden = await api.get('/echo/x', {headers: {'X-Custom': 'override', Authorization: 'Bearer other'}})
        assert.equal(overridden.headers.custom, 'override')
        assert.equal(overridden.headers.authorization, 'Bearer other')
    })

    test('an empty response gives null and a non-JSON response gives its text', async () => {
        const api = createClient(baseUrl)

        assert.equal(await api.get('/empty'), null)
        assert.equal(await api.get('/text'), 'plain words')
    })
})


describe('api-client-kit: failure cases', () => {
    test('a non-2xx response throws an ApiError with the server\'s status, message and details', async () => {
        const err = await failure(() => createClient(baseUrl).get('/missing'))

        assert.ok(isApiError(err))
        assert.equal(err.statusCode, 404)
        assert.equal(err.message, 'Item not found')
        assert.deepEqual(err.details, {id: '9'})
    })

    test('a plain-text error body falls back to the status text, with no details', async () => {
        const err = await failure(() => createClient(baseUrl).get('/boom'))

        assert.ok(isApiError(err))
        assert.equal(err.statusCode, 500)
        assert.equal(err.message, 'Internal Server Error')
        assert.equal(err.details, null)
    })

    test('a route the server does not have is a 404 ApiError too', async () => {
        const err = await failure(() => createClient(baseUrl).get('/nothing-here'))

        assert.ok(isApiError(err))
        assert.equal(err.statusCode, 404)
    })

    test('a request that takes too long throws status 0, with the original error as the cause', async () => {
        const err = await failure(() => createClient(baseUrl, {timeout: 100}).get('/slow'))

        assert.ok(isApiError(err))
        assert.equal(err.statusCode, 0)
        assert.match(err.message, /api-client: request timed out after 100ms/)
        assert.ok(err.cause)
    })

    test('a connection that is refused throws status 0', async () => {
        // find a port nothing is listening on: open a server, note its port, close it
        const closed = await new Promise((resolve) => { const s = express().listen(0, () => resolve(s)) })
        const deadUrl = `http://127.0.0.1:${closed.address().port}`
        await new Promise((resolve) => closed.close(resolve))

        const err = await failure(() => createClient(deadUrl).get('/x'))

        assert.ok(isApiError(err))
        assert.equal(err.statusCode, 0)
        assert.match(err.message, /api-client: network error/)
        assert.ok(err.cause)
    })

    test('wrong options when creating a client are a SetupError', () => {
        const cases = [
            ['empty baseUrl', () => createClient('')],
            ['missing baseUrl', () => createClient()],
            ['getToken that is not a function', () => createClient(baseUrl, {getToken: 'abc'})],
            ['headers that are not an object', () => createClient(baseUrl, {headers: ['a']})],
            ['timeout of zero', () => createClient(baseUrl, {timeout: 0})],
            ['timeout that is not an integer', () => createClient(baseUrl, {timeout: 1.5})]
        ]

        for (const [label, call] of cases) {
            assert.throws(call, (err) => err instanceof SetupError && /^api-client: /.test(err.message), label)
        }
    })

    test('wrong arguments to a request are a SetupError, thrown before anything is sent', async () => {
        const api = createClient(baseUrl)
        const cases = [
            ['unknown method', () => api.request('fetch', '/echo/x')],
            ['path without a leading slash', () => api.get('echo/x')],
            ['missing path', () => api.get()],
            ['GET with a body', () => api.request('get', '/echo/x', {body: {a: 1}})],
            ['query that is not an object', () => api.get('/echo/x', {query: 'a=1'})],
            ['headers that are not an object', () => api.get('/echo/x', {headers: 'a'})]
        ]

        for (const [label, call] of cases) {
            const err = await failure(call)

            assert.ok(err instanceof SetupError && !isApiError(err), label)
            assert.match(err.message, /^api-client: /, label)
        }
    })
})


describe('api-client-kit: contract', () => {
    test('the module exports createClient, and a client has exactly the methods the README lists', () => {
        assert.equal(typeof createClient, 'function')
        assert.deepEqual(Object.keys(createClient(baseUrl)).sort(), ['delete', 'get', 'patch', 'post', 'put', 'request'])
    })

    test('failures are guard-kit errors, so one isApiError check handles server errors, timeouts and network errors', async () => {
        const err = await failure(() => createClient(baseUrl).get('/missing'))

        assert.ok(err instanceof ApiError)
        assert.equal(typeof err.statusCode, 'number')
    })

    test('depends only on guard-kit, and reads neither the environment nor browser storage', () => {
        const requires = [...source.matchAll(/require\(['"]([^'"]+)['"]\)/g)].map((match) => match[1])

        assert.deepEqual(requires, ['../guard-kit'])
        assert.ok(!/process\.env/.test(source))
        assert.ok(!/localStorage|sessionStorage/.test(source))
    })
})

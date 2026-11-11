'use strict'

// api-kit tests (Node's built-in test runner)
// Run on their own with: node --test api-kit/tests/api-kit.test.js

const {describe, test} = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const express = require('express')

const {sendSuccess, sendCreated, sendNoContent, asyncHandler, buildRouter} = require('..')
const {ApiError, SetupError, isApiError} = require('../../guard-kit')


const source = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8')

const TOKEN = 'test-token'

// a response object that records what was sent, standing in for Express's res
function fakeRes() {
    const res = {
        statusCode: undefined,
        body: undefined,
        jsonCalled: false,
        sendCalled: false,
        sentArgs: undefined,
        status(code) { res.statusCode = code; return res },
        json(body) { res.jsonCalled = true; res.body = body; return res },
        send(...args) { res.sendCalled = true; res.sentArgs = args; return res }
    }
    return res
}

// an in-memory controller with the five functions the default routes expect
function makeController() {
    const items = new Map()
    let nextId = 1
    const notFound = (id) => ApiError.notFound('Item not found', {details: {id}})

    return {
        async findMany(req, res) { return sendSuccess(res, [...items.values()]) },
        async findOne(req, res) {
            if (!items.has(req.params.id)) throw notFound(req.params.id)
            return sendSuccess(res, items.get(req.params.id))
        },
        async create(req, res) {
            const item = {id: String(nextId++), ...req.body}
            items.set(item.id, item)
            return sendCreated(res, item)
        },
        async update(req, res) {
            if (!items.has(req.params.id)) throw notFound(req.params.id)
            const updated = {...items.get(req.params.id), ...req.body, id: req.params.id}
            items.set(updated.id, updated)
            return sendSuccess(res, updated)
        },
        async remove(req, res) {
            if (!items.delete(req.params.id)) throw notFound(req.params.id)
            return sendNoContent(res)
        }
    }
}

// the writes need this header, so tests can see which routes are protected
function requireToken(req, res, next) {
    if (req.get('authorization') !== `Bearer ${TOKEN}`) return next(ApiError.unauthorized('Missing or invalid token'))
    next()
}

// mounts a router on a real Express app, listening on a free port
function serve(router) {
    const app = express()
    app.use(express.json())
    app.use('/items', router)
    app.use((err, req, res, next) => {
        const status = isApiError(err) ? err.statusCode : 500
        res.status(status).json({success: false, error: err.message, details: err.details ?? null})
    })

    return new Promise((resolve) => {
        const server = app.listen(0, () => {
            const base = `http://127.0.0.1:${server.address().port}/items`

            resolve({
                close: () => new Promise((done) => { server.close(done); server.closeAllConnections() }),
                // returns { status, body }: the parsed JSON, null when empty, or the raw text for non-JSON replies
                async call(method, path = '', {body, token} = {}) {
                    const headers = {'Content-Type': 'application/json'}
                    if (token) headers.Authorization = `Bearer ${token}`
                    const res = await fetch(base + path, {method, headers, body: body ? JSON.stringify(body) : undefined})
                    const text = await res.text()
                    try {
                        return {status: res.status, body: text ? JSON.parse(text) : null}
                    } catch {
                        return {status: res.status, body: text}
                    }
                }
            })
        })
    })
}

// runs a test body against a served router, and always shuts the server down
async function withServer(router, body) {
    const server = await serve(router)
    try {
        await body(server)
    } finally {
        await server.close()
    }
}


describe('api-kit: success cases', () => {
    test('sendSuccess sends the success envelope, with a custom status and extra fields', () => {
        const plain = sendSuccess(fakeRes(), {name: 'Test'})
        assert.equal(plain.statusCode, 200)
        assert.deepEqual(plain.body, {success: true, data: {name: 'Test'}})

        const custom = sendSuccess(fakeRes(), [1, 2], 202, {page: 2, total: 40})
        assert.equal(custom.statusCode, 202)
        // extra fields sit next to success and data, not inside data
        assert.deepEqual(custom.body, {success: true, data: [1, 2], page: 2, total: 40})
    })

    test('sendCreated uses 201, and sendNoContent uses 204 with no body', () => {
        const created = sendCreated(fakeRes(), {id: '1'})
        assert.equal(created.statusCode, 201)
        assert.deepEqual(created.body, {success: true, data: {id: '1'}})

        const empty = sendNoContent(fakeRes())
        assert.equal(empty.statusCode, 204)
        assert.equal(empty.sendCalled, true)
        assert.equal(empty.jsonCalled, false)
    })

    test('asyncHandler passes req, res and next through, and stays quiet when the handler succeeds', async () => {
        const seen = []
        const handler = asyncHandler(async (req, res, next) => { seen.push([req, res, next]) })
        const next = () => { throw new Error('next should not be called') }

        await handler('req', 'res', next)

        assert.deepEqual(seen, [['req', 'res', next]])
        assert.equal(handler.length, 3)
    })

    test('the default routes give full CRUD over HTTP', async () => {
        await withServer(buildRouter(makeController(), {auth: requireToken}), async ({call}) => {
            const created = await call('POST', '', {token: TOKEN, body: {name: 'fern'}})
            assert.equal(created.status, 201)
            assert.deepEqual(created.body, {success: true, data: {id: '1', name: 'fern'}})

            assert.deepEqual((await call('GET')).body.data, [{id: '1', name: 'fern'}])
            assert.equal((await call('GET', '/1')).body.data.name, 'fern')

            const put = await call('PUT', '/1', {token: TOKEN, body: {name: 'moss'}})
            assert.equal(put.body.data.name, 'moss')

            const patch = await call('PATCH', '/1', {token: TOKEN, body: {size: 'small'}})
            assert.deepEqual(patch.body.data, {id: '1', name: 'moss', size: 'small'})

            const removed = await call('DELETE', '/1', {token: TOKEN})
            assert.equal(removed.status, 204)
            assert.equal(removed.body, null)
        })
    })

    test('writes need the auth middleware (PUT and PATCH included) and reads do not', async () => {
        await withServer(buildRouter(makeController(), {auth: requireToken}), async ({call}) => {
            await call('POST', '', {token: TOKEN, body: {name: 'fern'}})

            for (const [method, path] of [['POST', ''], ['PUT', '/1'], ['PATCH', '/1'], ['DELETE', '/1']]) {
                const res = await call(method, path, {body: {name: 'x'}})
                assert.equal(res.status, 401, `${method} ${path} without a token`)
            }
            assert.equal((await call('GET')).status, 200)
            assert.equal((await call('GET', '/1')).status, 200)
        })
    })

    test('protect chooses which functions get the auth middleware', async () => {
        const router = buildRouter(makeController(), {auth: requireToken, protect: ['findMany']})

        await withServer(router, async ({call}) => {
            assert.equal((await call('GET')).status, 401)
            assert.equal((await call('POST', '', {body: {name: 'open'}})).status, 201)
        })
    })

    test('custom routes build only the routes given, and the method is not case sensitive', async () => {
        const router = buildRouter(
            {findMany: makeController().findMany},
            {routes: [{method: 'GET', path: '/', func: 'findMany'}]}
        )

        await withServer(router, async ({call}) => {
            assert.equal((await call('GET')).status, 200)
            assert.equal((await call('POST', '', {body: {}})).status, 404)
            assert.equal((await call('GET', '/1')).status, 404)
        })
    })
})


describe('api-kit: failure cases', () => {
    const controller = makeController()
    const setupError = (pattern) => (err) => err instanceof SetupError && !isApiError(err) && pattern.test(err.message)

    test('buildRouter rejects bad options when it is called', () => {
        assert.throws(() => buildRouter(), setupError(/api-kit: controller must be a plain object/))
        assert.throws(() => buildRouter([]), setupError(/api-kit: controller must be a plain object/))
        assert.throws(() => buildRouter(controller, {auth: 'secret'}), setupError(/api-kit: auth must be a function, or omitted/))
        assert.throws(() => buildRouter(controller, {routes: []}), setupError(/api-kit: routes must be a non-empty array/))
        assert.throws(() => buildRouter(controller, {routes: 'get /'}), setupError(/api-kit: routes must be a non-empty array/))
        assert.throws(() => buildRouter(controller, {protect: []}), setupError(/api-kit: protect must be a non-empty array, or omitted/))
        assert.throws(() => buildRouter(controller, {protect: 'create'}), setupError(/api-kit: protect must be a non-empty array, or omitted/))
    })

    test('buildRouter rejects a malformed route and says which field is wrong', () => {
        const route = (overrides) => ({routes: [{method: 'get', path: '/', func: 'findMany', ...overrides}]})

        assert.throws(() => buildRouter(controller, route({method: 'fetch'})), setupError(/must be one of: get, post, patch, put, delete/))
        assert.throws(() => buildRouter(controller, route({path: 'items'})), setupError(/path must be a string starting with '\/'/))
        assert.throws(() => buildRouter(controller, route({func: undefined})), setupError(/func must be a non-empty string/))
    })

    test('buildRouter rejects a route whose function the controller does not have', () => {
        const incomplete = {findMany: controller.findMany}

        assert.throws(() => buildRouter(incomplete), setupError(/controller\.func must be a function/))
    })

    test('an error thrown by a controller reaches the error handler with its status', async () => {
        await withServer(buildRouter(controller), async ({call}) => {
            const res = await call('GET', '/999')

            assert.equal(res.status, 404)
            assert.deepEqual(res.body, {success: false, error: 'Item not found', details: {id: '999'}})
        })
    })

    test('an unexpected error from a controller becomes a 500 instead of hanging the request', async () => {
        const broken = {...makeController(), findMany: async () => { throw new Error('database exploded') }}

        await withServer(buildRouter(broken), async ({call}) => {
            const res = await call('GET')

            assert.equal(res.status, 500)
            assert.equal(res.body.error, 'database exploded')
        })
    })

    test('asyncHandler passes a rejected promise to next, once', async () => {
        const boom = new Error('boom')
        const forwarded = []

        await asyncHandler(async () => { throw boom })('req', 'res', (err) => forwarded.push(err))

        assert.deepEqual(forwarded, [boom])
    })
})


describe('api-kit: contract', () => {
    test('exports exactly what the README lists', () => {
        assert.deepEqual(Object.keys(require('..')).sort(), [
            'asyncHandler', 'buildRouter', 'sendCreated', 'sendNoContent', 'sendSuccess'
        ])
    })

    test('the default protection covers create, update and remove, and nothing else', async () => {
        const protectedCalls = []
        const spy = (req, res, next) => { protectedCalls.push(`${req.method} ${req.path}`); next() }

        await withServer(buildRouter(makeController(), {auth: spy}), async ({call}) => {
            await call('POST', '', {body: {name: 'a'}})
            await call('GET')
            await call('GET', '/1')
            await call('PUT', '/1', {body: {name: 'b'}})
            await call('PATCH', '/1', {body: {name: 'c'}})
            await call('DELETE', '/1')
        })

        assert.deepEqual(protectedCalls, ['POST /', 'PUT /1', 'PATCH /1', 'DELETE /1'])
    })

    test('depends only on express and guard-kit, and does not read the environment', () => {
        const requires = [...source.matchAll(/require\(['"]([^'"]+)['"]\)/g)].map((match) => match[1]).sort()

        assert.deepEqual(requires, ['../guard-kit', 'express'])
        assert.ok(!/process\.env/.test(source))
    })
})

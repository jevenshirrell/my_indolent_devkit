'use strict'

// db-kit tests (Node's built-in test runner)
// Run on their own with: node --test db-kit/tests/db-kit.test.js
//
// Most tests need no database: schemas are built for real, and the repository is tested
// against a real Mongoose model whose query methods are replaced with fakes.
// The last block talks to a real MongoDB and only runs when MONGO_URI is set:
//   node --env-file=.env --test db-kit/tests/db-kit.test.js

const {describe, test, before, after} = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const mongoose = require('mongoose')

const {connectDatabase, disconnectDatabase, isConnected, createSchema, buildRepository} = require('..')
const {ApiError, SetupError, isApiError} = require('../../guard-kit')


const source = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8')

const Note = mongoose.model('Note', createSchema({title: {type: String, required: true}, priority: {type: Number, default: 1}}))

// what model.find() returns: chainable like a Mongoose query, and awaitable
function fakeQuery(result) {
    const calls = []
    const query = {
        calls,
        sort(arg) { calls.push(['sort', arg]); return query },
        skip(arg) { calls.push(['skip', arg]); return query },
        limit(arg) { calls.push(['limit', arg]); return query },
        then(resolve, reject) { return Promise.resolve(result).then(resolve, reject) }
    }
    return query
}


describe('db-kit: success cases', () => {
    test('createSchema adds timestamps by default', () => {
        const schema = createSchema({title: String})

        assert.ok(schema instanceof mongoose.Schema)
        assert.ok(schema.path('createdAt'))
        assert.ok(schema.path('updatedAt'))
    })

    test('JSON output has id, and no _id or __v', () => {
        const doc = Note.hydrate({_id: new mongoose.Types.ObjectId(), title: 'first', __v: 0})
        const json = JSON.parse(JSON.stringify(doc))

        assert.match(json.id, /^[0-9a-f]{24}$/)
        assert.equal(json.title, 'first')
        assert.equal('_id' in json, false)
        assert.equal('__v' in json, false)
    })

    test('caller options override the defaults', () => {
        const schema = createSchema({title: String}, {timestamps: false})

        assert.equal(schema.path('createdAt'), undefined)
        assert.equal(schema.path('updatedAt'), undefined)
    })

    test('passing toJSON replaces the whole default toJSON (the override is shallow)', () => {
        const schema = createSchema({title: String}, {toJSON: {virtuals: false}})

        assert.deepEqual(schema.options.toJSON, {virtuals: false})
    })

    test('buildRepository gives a real model the five operations', () => {
        const repo = buildRepository(Note)

        assert.deepEqual(Object.keys(repo).sort(), ['create', 'findMany', 'findOne', 'remove', 'update'])
    })

    test('findMany uses newest-first, limit 20 and skip 0 by default', async (t) => {
        const query = fakeQuery([{title: 'a'}])
        const find = t.mock.method(Note, 'find', () => query)

        const records = await buildRepository(Note).findMany()

        assert.deepEqual(records, [{title: 'a'}])
        assert.deepEqual(find.mock.calls[0].arguments, [{}])
        assert.deepEqual(query.calls, [['sort', {createdAt: -1}], ['skip', 0], ['limit', 20]])
    })

    test('findMany passes the filter, sort, limit and skip it is given', async (t) => {
        const query = fakeQuery([])
        const find = t.mock.method(Note, 'find', () => query)

        await buildRepository(Note).findMany({priority: 2}, {title: 1}, {limit: 5, skip: 10})

        assert.deepEqual(find.mock.calls[0].arguments, [{priority: 2}])
        assert.deepEqual(query.calls, [['sort', {title: 1}], ['skip', 10], ['limit', 5]])
    })

    test('findOne, create, update and remove pass the right arguments and return the record', async (t) => {
        const record = {id: '1', title: 'a'}
        const findById = t.mock.method(Note, 'findById', async () => record)
        const create = t.mock.method(Note, 'create', async (data) => ({...data, id: '2'}))
        const update = t.mock.method(Note, 'findByIdAndUpdate', async () => ({...record, priority: 5}))
        const remove = t.mock.method(Note, 'findByIdAndDelete', async () => record)
        const repo = buildRepository(Note)

        assert.equal(await repo.findOne('1'), record)
        assert.deepEqual(findById.mock.calls[0].arguments, ['1'])

        assert.deepEqual(await repo.create({title: 'b'}), {title: 'b', id: '2'})
        assert.deepEqual(create.mock.calls[0].arguments, [{title: 'b'}])

        // update returns the new record and runs the schema's validators
        assert.equal((await repo.update('1', {priority: 5})).priority, 5)
        assert.deepEqual(update.mock.calls[0].arguments, ['1', {priority: 5}, {new: true, runValidators: true}])

        assert.equal(await repo.remove('1'), record)
        assert.deepEqual(remove.mock.calls[0].arguments, ['1'])
    })

    test('isConnected is false when no connection has been made', () => {
        assert.equal(isConnected(), false)
    })
})


describe('db-kit: failure cases', () => {
    test('createSchema rejects fields that are not a plain object', () => {
        for (const bad of [undefined, null, [], 'name', 5]) {
            assert.throws(
                () => createSchema(bad),
                (err) => err instanceof SetupError && /db-kit: fields must be a plain object/.test(err.message),
                `fields ${String(bad)}`
            )
        }
    })

    test('buildRepository rejects anything that is not a Mongoose model', () => {
        class NotAModel {}
        const lookalike = {find() {}, findById() {}, create() {}, findByIdAndUpdate() {}, findByIdAndDelete() {}}

        for (const bad of [{}, lookalike, NotAModel]) {
            assert.throws(
                () => buildRepository(bad),
                (err) => err instanceof SetupError && /db-kit: model must be a mongoose model/.test(err.message)
            )
        }
    })

    test('findOne, update and remove throw a 404 ApiError when nothing matches', async (t) => {
        t.mock.method(Note, 'findById', async () => null)
        t.mock.method(Note, 'findByIdAndUpdate', async () => null)
        t.mock.method(Note, 'findByIdAndDelete', async () => null)
        const repo = buildRepository(Note)

        for (const call of [() => repo.findOne('x'), () => repo.update('x', {title: 'a'}), () => repo.remove('x')]) {
            await assert.rejects(call, (err) => isApiError(err) && err.statusCode === 404)
        }
    })

    test('findMany returns an empty list, not an error, when nothing matches', async (t) => {
        t.mock.method(Note, 'find', () => fakeQuery([]))

        assert.deepEqual(await buildRepository(Note).findMany({title: 'nothing'}), [])
    })

    test('an error from the model passes through unchanged', async (t) => {
        const boom = new Error('connection lost')
        t.mock.method(Note, 'create', async () => { throw boom })

        await assert.rejects(() => buildRepository(Note).create({title: 'a'}), (err) => err === boom)
    })
})


describe('db-kit: contract', () => {
    test('exports exactly what the README lists', () => {
        assert.deepEqual(Object.keys(require('..')).sort(), [
            'buildRepository', 'connectDatabase', 'createSchema', 'disconnectDatabase', 'isConnected'
        ])
    })

    test('depends only on mongoose and guard-kit, and does not read the environment', () => {
        const requires = [...source.matchAll(/require\(['"]([^'"]+)['"]\)/g)].map((match) => match[1]).sort()

        assert.deepEqual(requires, ['../guard-kit', 'mongoose'])
        assert.ok(!/process\.env/.test(source))
    })
})


// Needs a real MongoDB. Skipped unless MONGO_URI is set (connectDatabase ends the process if it cannot connect).
describe('db-kit: against a real MongoDB', {skip: !process.env.MONGO_URI && 'set MONGO_URI to run'}, () => {
    let Item

    before(async () => {
        Item = mongoose.model('DevkitTestItem', createSchema({name: {type: String, required: true}, age: {type: Number, required: true}}))
        await connectDatabase(process.env.MONGO_URI)
    })

    after(async () => {
        await Item.deleteMany({})
        await disconnectDatabase()
    })

    test('connects, and isConnected reports it', () => {
        assert.equal(isConnected(), true)
    })

    test('create, findMany, update, findOne and remove work end to end', async () => {
        const repo = buildRepository(Item)

        const created = await repo.create({name: 'Test', age: 111})
        assert.equal((await repo.findMany()).length, 1)

        const updated = await repo.update(created.id, {name: 'Test 2'})
        assert.equal(updated.name, 'Test 2')
        assert.equal((await repo.findOne(created.id)).name, 'Test 2')

        await repo.remove(created.id)
        await assert.rejects(() => repo.findOne(created.id), (err) => isApiError(err) && err.statusCode === 404)
    })

    test('the schema validators run on create and update', async () => {
        const repo = buildRepository(Item)

        await assert.rejects(() => repo.create({age: 5}), (err) => err.name === 'ValidationError')
        const created = await repo.create({name: 'Valid', age: 5})
        await assert.rejects(() => repo.update(created.id, {age: 'not a number'}), (err) => err.name === 'ValidationError' || err.name === 'CastError')
    })
})

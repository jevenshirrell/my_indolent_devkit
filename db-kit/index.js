'use strict'


const mongoose = require('mongoose')
const {validate, oneOf, optional, startsWith, createGuard, ApiError, SetupError} = require('../guard-kit')


const guard = createGuard('db-kit')

// Connection
let listenersAttached = false

function attachListeners() {
    // makes sure to exit if func alr ran
    if (listenersAttached) return
    
    listenersAttached = true
    mongoose.connection.on('connected', () => {
        console.log(`MongoDB Connected: ${mongoose.connection.name}`)
    })
    mongoose.connection.on('error', () => {
        console.log(`MongoDB error: ${err.message}`)
    })
    mongoose.connection.on('disconnected', () => {
        console.log(`MongoDB disconnected`)
    })
}

async function connectDatabase(uri) {
    mongoose.set("strictQuery", true)
    attachListeners()

    try {
        await mongoose.connect(uri, {
            serverSelectionTimeoutMS:10000
        })
    } catch (err) {
        console.log(`Couldn't connect to MongoDB: ${err.message}`)
        process.exit(1)
    }
}
async function disconnectDatabase() {
    await mongoose.connection.close()
}
function isConnected() {
    return mongoose.connection.readyState === 1
}

// Schema defaults
function createSchema(fields, options = {}) {
    guard.expect(fields, 'fields', validate.object, {setup:true})

    return new mongoose.Schema(fields, {
        timestamps:true,
        toJSON:{
            virtuals:true,
            versionKey:false,
            transform(doc, ret) {
                ret.id = ret._id
                delete ret._id
                return ret
            }
        },
        toObject:{ virtuals:true },
        ...options
    })
}

// Repository
function buildRepository(model) {
    guard.expect(model.prototype, 'model', rule('a mongoose model', (v) => v instanceof mongoose.Model), {setup:true})

    async function findMany(filter = {}, sort = Object.freeze({createdAt: -1}), {limit = 20, skip = 0} = {}) {
        return await model.find(filter).sort(sort).skip(skip).limit(limit)
    }
    async function findOne(id) {
        const record = await model.findById(id)
        if (!record) throw ApiError.notFound()
        return record
    }
    async function create(data) {
        return await model.create(data)
    }
    async function update(id, data) {
        const record = await model.findByIdAndUpdate(id, data, { new:true, runValidators:true })
        if (!record) throw ApiError.notFound()
        return record
    }
    async function remove(id) {
        const record = await model.findByIdAndDelete(id)
        if (!record) throw ApiError.notFound()
        return record
    }

    return {findMany, findOne, create, update, remove}
}

module.exports = {connectDatabase, disconnectDatabase, isConnected, createSchema, buildRepository}
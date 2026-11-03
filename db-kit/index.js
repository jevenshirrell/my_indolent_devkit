'use-strict'


const mongoose = require('mongoose')


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

// Repository
function createRepository(schema) {
    if (typeof schema !== mongoose.Schema) {
        throw new Error('db-kit: invalid schema in repository')
    }
}

module.exports = {connectDatabase, disconnectDatabase, isConnected}
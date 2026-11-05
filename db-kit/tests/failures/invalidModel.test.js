'use strict'

// Tests passing invalid model to createRepository
// REMINDER: run with --env-file=.env argument or pass your own URI

const mongoose = require('mongoose')
const {createSchema, createRepository, connectDatabase, disconnectDatabase} = require('../../../db-kit')

const schema = createSchema({ name:{type:String, required:true}, age:{type:Number, required:true} })
const TestModel = {}

connectDatabase(process.env.MONGO_URI).then(async () => {
    const repo = createRepository(TestModel)

    // repo.create({ name:'Test', age:111})
    
    disconnectDatabase()
})
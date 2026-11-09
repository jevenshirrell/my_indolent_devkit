'use strict'

// Tests passing invalid model to buildRepository
// REMINDER: run with --env-file=.env argument or pass your own URI

const mongoose = require('mongoose')
const {createSchema, buildRepository, connectDatabase, disconnectDatabase} = require('../../../db-kit')

const schema = createSchema({ name:{type:String, required:true}, age:{type:Number, required:true} })
const TestModel = {}

connectDatabase(process.env.MONGO_URI).then(async () => {
    const repo = buildRepository(TestModel)

    // repo.create({ name:'Test', age:111})
    
    disconnectDatabase()
})
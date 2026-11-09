'use strict'

// Tests basic CRUD functions
// REMINDER: run with --env-file=.env argument or pass your own URI

const mongoose = require('mongoose')
const {createSchema, buildRepository, connectDatabase, disconnectDatabase} = require('../../../db-kit')

const schema = createSchema({ name:{type:String, required:true}, age:{type:Number, required:true} })
const TestModel = mongoose.model('Test', schema)

connectDatabase(process.env.MONGO_URI).then(async () => {
    const repo = buildRepository(TestModel)

    let record = await repo.create({name:'Test', age:111})
    console.log(await repo.findMany())
    record = await repo.update(record.id, {name:'Test 2'})
    console.log(await repo.findOne(record.id))
    await repo.remove(record.id)
    
    disconnectDatabase()
})
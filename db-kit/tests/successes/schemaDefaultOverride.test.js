'use strict'

// Tests creating a schema and overriding the defaults

const {createSchema} = require('../../../db-kit')


let schema = {
    name:{type:String, required:true},
    age:{type:Number, required:true}
}

console.log(createSchema(schema, { timestamps:false }))
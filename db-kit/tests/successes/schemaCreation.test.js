'use strict'

// Tests creating a schema w/ defaults

const {createSchema} = require('../../../db-kit')


let schema = {
    name:{type:String, required:true},
    age:{type:Number, required:true}
}

console.log(createSchema(schema))
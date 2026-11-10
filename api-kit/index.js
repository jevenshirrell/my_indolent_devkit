'use strict'


const express = require('express')
const {validate, oneOf, optional, startsWith, createGuard} = require('../guard-kit')


const guard = createGuard('api-kit')

// Response envelopes
function sendSuccess(res, data, statusCode = 200, extra = {}) {
    return res.status(statusCode).json({success:true, data, ...extra})
}
function sendCreated(res, data) {
    return sendSuccess(res, data, 201)
}
function sendNoContent(res) {
    return res.status(204).send()
}

// async wrapper
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)

// CRUD router
const defRoutes = [
    { method:'get', path:'/', func:'findMany' },
    { method:'post', path:'/', func:'create' },
    { method:'get', path:'/:id', func:'findOne' },
    { method:'put', path:'/:id', func:'update' },
    { method:'patch', path:'/:id', func:'update' },
    { method:'delete', path:'/:id', func:'remove' }
]

function buildRouter(controller, {auth, routes = defRoutes, protect = ['create', 'update', 'remove']} = {}) {
    // validate param input
    guard.expect(controller, 'controller', validate.object, {setup:true})
    guard.expect(auth, 'auth', optional(validate.function), {setup:true})
    guard.expect(routes, 'routes', validate.nonEmptyArray, {setup:true})
    guard.expect(protect, 'protect', optional(validate.nonEmptyArray), {setup:true})

    const router = express.Router()
    
    for (const { method, path, func } of routes) {
        const verb = typeof method === 'string' ? method.toLowerCase() : method
        // validate route input
        guard.validateObject(
            {verb, path, func},
            {
                verb:oneOf(['get', 'post', 'patch', 'put', 'delete']),
                path:startsWith('/'),
                func:validate.nonEmptyString,
            },
            {setup:true}
        )
        guard.expect(controller[func], 'controller.func', validate.function, {setup:true})

        // add handlers
        const handlers = []
        if (auth && protect.includes(func)) handlers.push(auth)
        handlers.push(asyncHandler((req, res, next) => controller[func](req, res, next)))

        // create route
        router[verb](path, ...handlers)
    }

    return router
}

module.exports = {sendSuccess, sendCreated, sendNoContent, asyncHandler, buildRouter}
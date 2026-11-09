'use strict'


const express = require('express')


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
    if (!controller || typeof controller !== 'object') {
        throw new Error(`api-kit: controller must be an object (got ${typeof controller})`)
    }
    if (auth && typeof auth !== 'function') {
        throw new Error(`api-kit: options.auth must be a middleware function (got ${typeof auth})`)
    }
    if (!Array.isArray(routes) || routes.length === 0) {
        throw new Error(`api-kit: routes must be a non-empty array`)
    }
    if (protect && !Array.isArray(protect)) {
        throw new Error(`api-kit: options.protect must be an array`)
    }

    const router = express.Router()
    
    for (const { method, path, func } of routes) {
        // validate route input
        for (const [name, value] of Object.entries({ func, method, path })) {
            if (typeof value !== 'string' || value === '') {
                throw new Error(`api-kit: route key '${name}' must be a non-empty string (got ${typeof value})`)
            }
        }
        if (!['get', 'post', 'patch', 'put', 'delete'].includes(method.toLowerCase())) {
            throw new Error(`api-kit: '${method}' is not a valid HTTP method`)
        }
        if (!path.startsWith('/')) {
            throw new Error(`api-kit: '${path}' is not a valid path`)
        }
        if (typeof controller[func] !== 'function') {
            throw new Error(`api-kit: function '${func}' is missing from controller or not a valid function`)
        }

        // add handlers
        const handlers = []
        if (auth && protect.includes(func)) handlers.push(auth)
        handlers.push(asyncHandler((req, res, next) => controller[func](req, res, next)))

        // create route
        router[method.toLowerCase()](path, ...handlers)
    }

    return router
}

module.exports = {sendSuccess, sendCreated, sendNoContent, asyncHandler, buildRouter}
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
function buildRouter(controller, options = {}) {
    const router = express.Router()
    
    router
        .route('/')
            .get(controller.findMany)
            .post(auth, controller.create)
    router
        .route('/:id', auth)
            .get(controller.findOne)
            .put(controller.update)
            .patch(controller.update)
            .delete(controller.remove)

    return router
}

module.exports = {sendSuccess, sendCreated, sendNoContent, asyncHandler, buildRouter}
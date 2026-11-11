# api-kit

## What it does

Small Express helpers you can drop into any API project:

- **Response envelopes:** one consistent JSON shape for success responses (`{ success: true, data }`)
- **Async wrapper:** forwards errors from async handlers to Express's error handling, so a rejected promise doesn't leave a request hanging
- **CRUD router builder:** turns a controller object into an Express router from a table of routes, with optional auth middleware on the operations you choose

It imports nothing from your app and does not know about any database, model, or auth library. The controller, the auth middleware, and the route table are all passed in by the caller. Its validation errors come from guard-kit, the one other module it depends on.

## Install

Copy the `api-kit/` folder into your project **next to the `guard-kit/` folder**, because api-kit imports it as `../guard-kit`. Then make sure Express is installed:

```bash
npm install express
```

## Usage

Save this as `server.js` next to the `api-kit/` and `guard-kit/` folders and run `node server.js`:

```js
const express = require('express');
const { buildRouter, sendSuccess, sendCreated, sendNoContent } = require('./api-kit');
const { ApiError, isApiError } = require('./guard-kit');

// A controller: plain functions that take (req, res, next).
// Here the "database" is a Map, but api-kit doesn't care what you use.
const items = new Map();
let nextId = 1;

const controller = {
  async findMany(req, res) {
    return sendSuccess(res, [...items.values()]);
  },
  async findOne(req, res) {
    const item = items.get(req.params.id);
    if (!item) throw ApiError.notFound('Item not found'); // rejected promise -> forwarded to next(err)
    return sendSuccess(res, item);
  },
  async create(req, res) {
    const item = { id: String(nextId++), ...req.body };
    items.set(item.id, item);
    return sendCreated(res, item);
  },
  async update(req, res) {
    const item = items.get(req.params.id);
    if (!item) throw ApiError.notFound('Item not found');
    const updated = { ...item, ...req.body, id: item.id };
    items.set(item.id, updated);
    return sendSuccess(res, updated);
  },
  async remove(req, res) {
    if (!items.delete(req.params.id)) throw ApiError.notFound('Item not found');
    return sendNoContent(res);
  },
};

// Any Express middleware can be the auth. This one checks a header.
function requireKey(req, res, next) {
  if (req.get('x-api-key') !== 'secret') return next(ApiError.unauthorized());
  next();
}

const app = express();
app.use(express.json());
app.use('/items', buildRouter(controller, { auth: requireKey }));

// api-kit does not handle errors for you; you decide how they look.
app.use((err, req, res, next) => {
  const status = isApiError(err) ? err.statusCode : 500;
  res.status(status).json({ success: false, error: err.message });
});

app.listen(3000, () => console.log('Listening on http://localhost:3000/items'));

// Try it:
//   curl http://localhost:3000/items                      -> 200 { "success": true, "data": [] }
//   curl -X POST http://localhost:3000/items \
//     -H "Content-Type: application/json" -d '{"name":"a"}'  -> 401 (create is protected)
//   curl -X POST http://localhost:3000/items \
//     -H "Content-Type: application/json" -H "x-api-key: secret" -d '{"name":"a"}'  -> 201
//   curl http://localhost:3000/items/999                  -> 404 { "success": false, "error": "Item not found" }
```

A read-only resource needs its own shorter route list, because the default list requires all five controller functions:

```js
const readOnly = buildRouter(
  { findMany: controller.findMany, findOne: controller.findOne },
  {
    routes: [
      { method: 'get', path: '/', func: 'findMany' },
      { method: 'get', path: '/:id', func: 'findOne' },
    ],
  }
);
```

## API

### `sendSuccess(res, data, [statusCode], [extra])`

Sends `res.status(statusCode).json({ success: true, data, ...extra })`.

| Param | Type | Default | Notes |
|---|---|---|---|
| `res` | Express response | required | |
| `data` | any JSON-serializable value | required | Placed under `data`. |
| `statusCode` | number | `200` | |
| `extra` | object | `{}` | Merged at the top level of the body, next to `success` and `data` (useful for things like pagination info). |

Returns the result of `res.json(...)`, so `return sendSuccess(...)` works in handlers.

### `sendCreated(res, data)`

Same as `sendSuccess(res, data, 201)`.

### `sendNoContent(res)`

Sends `res.status(204).send()` with no body.

### `asyncHandler(fn)` → `(req, res, next) => Promise`

Wraps a handler. If the handler returns a promise that rejects, the error is passed to `next(err)`. The returned function takes three arguments, so Express treats it as a normal handler, not an error handler.

### `buildRouter(controller, [options])` → `express.Router`

Builds a router from a controller. Every handler is wrapped in `asyncHandler`.

| Param | Type | Default | Notes |
|---|---|---|---|
| `controller` | object | required | Holds the functions named in `routes`. Each is called as `controller[func](req, res, next)`. |
| `options.auth` | function | none | Express middleware. If omitted, no route is protected. |
| `options.routes` | array | see below | Route table. Must be a non-empty array. |
| `options.protect` | string[] | `['create', 'update', 'remove']` | Controller function names that get `auth` in front of them. If given, must be a non-empty array. |

**Default routes**

| Method | Path | Controller function |
|---|---|---|
| GET | `/` | `findMany` |
| POST | `/` | `create` |
| GET | `/:id` | `findOne` |
| PUT | `/:id` | `update` |
| PATCH | `/:id` | `update` |
| DELETE | `/:id` | `remove` |

**Route entries** are objects `{ method, path, func }`:
- `method`: one of `get`, `post`, `put`, `patch`, `delete` (case-insensitive)
- `path`: a string starting with `/`
- `func`: the name of a function on the controller

**Errors thrown.** All are guard-kit `SetupError`s, and every message starts with `api-kit:`, names the argument, and says what it got:
- `controller` missing, not a plain object, or an array
- `options.auth` given but not a function
- `options.routes` empty or not an array
- `options.protect` given but not a non-empty array
- a route whose `method` is not one of the five verbs (reported as `verb`), whose `path` does not start with `/`, or whose `func` is missing or not a non-empty string. All of a route's problems are listed in one message.
- a `func` that the controller does not have as a function (reported as `controller.func`)

An entry in `routes` that is `null` or `undefined` throws a plain `TypeError` instead.

All validation happens when `buildRouter` is called, so a mistake fails at startup, not on the first request.

## Decisions

- **The controller is passed in; api-kit never imports a database, model, or repository.** It only needs an object with functions. Anything that follows the `(req, res, next)` shape works, so the module can be reused with any data layer. The trade-off is that the caller writes the glue between their data code and HTTP, since a repository that takes plain values (an id, a data object) can't be passed in directly.
- **Auth is a parameter, not an import.** api-kit does not depend on auth-kit or on any function named `requireAuth`. Any Express middleware works.
- **Protection is matched by function name, not by HTTP method.** Protecting `update` covers both PUT and PATCH, because both call `update`. Custom routes are protected the same way, by their `func` name.
- **Default protection is write operations only** (`create`, `update`, `remove`). Reads are public unless the caller lists them in `protect`.
- **If `auth` is omitted, nothing is protected, even routes listed in `protect`.** A mistake like importing the middleware from the wrong path (giving `undefined`) produces an open API without an error. Check that your middleware is actually defined when you wire it up.
- **The route table is data.** Routes are an array of `{ method, path, func }`, so callers can add, remove, or rename routes without changing the module.
- **A controller missing any function named in `routes` throws, rather than skipping that route.** A typo in a function name is caught at startup. The cost is that a read-only resource has to pass its own shorter `routes` list (shown in Usage).
- **Validation fails fast and loudly.** Every check runs at construction time with a message that names the module and the problem.
- **Envelope helpers are separate from the router.** The router doesn't send responses itself; controllers call `sendSuccess` and friends. Callers can use the router without the envelopes, or the envelopes without the router.
- **`extra` is merged last in `sendSuccess`.** That lets callers add top-level fields, but it also means passing `success` or `data` inside `extra` would replace the real values. Don't do that.
- **`asyncHandler` forwards rejected promises only.** An `async` function that throws becomes a rejection and is forwarded. A plain synchronous function that throws is not caught by the wrapper itself, though Express catches synchronous throws in its own handler layer.
- **Errors are not formatted here.** api-kit forwards errors with `next(err)` and leaves the response format to your error middleware. Because db-kit and auth-kit throw guard-kit's `ApiError`, a handler that reads `statusCode` with `isApiError` covers all of them.
- **This module imports guard-kit.** It is an outward dependency, which is allowed here because it is documented and defended. The defence: using guard-kit's `SetupError` and validators keeps every kit's startup errors the same shape and the same wording, and the shared `ApiError` is what lets one error handler serve the whole toolkit. guard-kit itself depends on nothing. The cost is that api-kit cannot be copied alone; `guard-kit/` must sit next to it.
- **Express is a required library dependency.** The router is created with `require('express')`, so the host project must have it installed. Declaring it as a peer dependency (in your `package.json`) avoids two copies of Express in one project.
- **Only five HTTP verbs are supported:** get, post, put, patch, delete.

## Changes

- **1.1.0** Validation now uses guard-kit, so bad arguments throw `SetupError` with consistent messages. `options.protect`, if given, must now be a non-empty array. Added the dependency on guard-kit.
- **1.0.0** Initial version: `sendSuccess`, `sendCreated`, `sendNoContent`, `asyncHandler`, `buildRouter` with a configurable route table, optional `auth`, and `protect` list.

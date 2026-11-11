# db-kit

## What it does

Reusable MongoDB plumbing for Mongoose projects:

- **Connection:** connect, disconnect, and check connection status, with the URI supplied by the caller
- **Schema defaults:** `createSchema(fields)` builds a Mongoose schema with shared options already applied (timestamps, clean JSON output)
- **Repository:** `buildRepository(model)` gives any Mongoose model the same five operations (find many, find one, create, update, remove)

It knows nothing about your fields, your models, or your environment. The URI, the field definitions, and the model are all passed in by the caller. Its errors come from guard-kit, the one other module it depends on.

## Install

Copy the `db-kit/` folder into your project **next to the `guard-kit/` folder**, because db-kit imports it as `../guard-kit`. Then install Mongoose:

```bash
npm install mongoose
```

You also need a running MongoDB (local or a hosted one such as Atlas) and its connection string.

## Usage

Save this as `try-db.js` next to the `db-kit/` and `guard-kit/` folders. The URI comes from the caller (here, an environment variable), never from the module.

```js
const mongoose = require('mongoose');
const { connectDatabase, disconnectDatabase, isConnected, createSchema, buildRepository } = require('./db-kit');

async function main() {
  await connectDatabase(process.env.MONGO_URI);
  console.log('connected:', isConnected()); // true

  // The caller defines the fields; db-kit adds timestamps and clean JSON output.
  const Note = mongoose.model('Note', createSchema({
    title: { type: String, required: true },
    priority: { type: Number, default: 1 },
  }));
  const notes = buildRepository(Note);

  const created = await notes.create({ title: 'first note' });
  console.log('created:', JSON.stringify(created)); // has "id", createdAt, updatedAt; no "_id" or "__v"

  console.log('list:', (await notes.findMany()).length); // 1

  const updated = await notes.update(created.id, { priority: 5 });
  console.log('updated priority:', updated.priority); // 5

  console.log('found:', (await notes.findOne(created.id)).title); // first note

  await notes.remove(created.id);

  try {
    await notes.findOne(created.id);
  } catch (err) {
    console.log('after remove:', err.statusCode, err.message); // 404 Not Found
  }

  await disconnectDatabase();
}

main();
```

Run it with your connection string in an environment variable:

```bash
node --env-file=.env try-db.js
```

where `.env` contains a line like `MONGO_URI=mongodb://127.0.0.1:27017/devkit-demo`.

## API

### Connection

#### `connectDatabase(uri)` → `Promise<void>`
Connects the default Mongoose connection to `uri`. It waits up to 10 seconds to find a server, and logs `MongoDB Connected: <name>` when it succeeds. On the first call it also attaches listeners that log the connection's `connected`, `disconnected`, and `error` events. It sets Mongoose's `strictQuery` option to `true`.

If the connection fails, it logs `Couldn't connect to MongoDB: <reason>` and **ends the process with exit code 1**.

#### `disconnectDatabase()` → `Promise<void>`
Closes the default connection.

#### `isConnected()` → `boolean`
`true` only when the connection is fully open.

### `createSchema(fields, [options])` → `mongoose.Schema`

| Param | Type | Notes |
|---|---|---|
| `fields` | object | Your field definitions, passed straight to `new mongoose.Schema`. Must be a plain object (not `null`, not an array). An empty object is accepted. |
| `options` | object | Schema options. Anything you pass overrides the defaults below. |

Defaults applied:

| Option | Default |
|---|---|
| `timestamps` | `true` (adds `createdAt` and `updatedAt`) |
| `toJSON` | `virtuals: true`, `versionKey: false`, and `_id` is replaced by `id` |
| `toObject` | `virtuals: true` |

Throws a `SetupError`, `db-kit: fields must be a plain object (got ...)`, if `fields` is missing or is not a plain object.

### `buildRepository(model)` → `{ findMany, findOne, create, update, remove }`

`model` must be a Mongoose model (the result of `mongoose.model(...)`). For anything else that is not `null` or `undefined` (a plain object, a class, a lookalike with the same methods) it throws a `SetupError`, `db-kit: model must be a mongoose model (got ...)`. Passing `null` or `undefined` throws a plain `TypeError`.

| Method | Returns | Behavior |
|---|---|---|
| `findMany([filter], [sort], [{ limit, skip }])` | `Promise<Document[]>` | Defaults: `filter = {}`, `sort = { createdAt: -1 }` (newest first), `limit = 20`, `skip = 0`. Returns an empty array when nothing matches. |
| `findOne(id)` | `Promise<Document>` | Finds one record **by id**. Throws a 404 `ApiError` if there is none. |
| `create(data)` | `Promise<Document>` | Creates and returns the new record. Schema validation errors are thrown by Mongoose. |
| `update(id, data)` | `Promise<Document>` | Updates by id, runs the schema's validators, and returns the **updated** record. Throws a 404 `ApiError` if there is none. |
| `remove(id)` | `Promise<Document>` | Deletes by id and returns the **deleted** record. Throws a 404 `ApiError` if there is none. |

The 404 is guard-kit's `ApiError.notFound()`, with status `404` and the message `Not Found`.

## Decisions

- **Everything project-specific is passed in.** The URI, the fields, and the model are parameters. The module never reads `process.env` and never imports a model from your app.
- **Mongoose is required inside the module.** The host project must have it installed. `buildRepository` checks that the model is an instance of *this* copy of Mongoose, so the app and db-kit must resolve to the same installed Mongoose. Declaring it as a peer dependency in your `package.json` prevents two copies. The same check means a hand-made fake model is rejected; tests replace methods on a real model instead.
- **One connection per process.** It uses Mongoose's default connection, so it doesn't support several databases at once.
- **Schema defaults are overridable, but shallowly.** Your `options` are spread last, so any option you give wins. That includes `toJSON`: passing your own `toJSON` replaces the whole default `toJSON` object, so you lose the `id` conversion unless you add it back.
- **`id` instead of `_id` in JSON.** The `id` field is an ObjectId on the object `toJSON()` returns, and becomes a string once serialized with `JSON.stringify` or sent through Express.
- **`findOne` takes an id, not a filter.** It uses `findById` underneath. The name matches the router in api-kit, but note that it differs from Mongoose's own `findOne`, which takes a filter.
- **A missing record is an error, an empty search is not.** `findOne`, `update`, and `remove` throw a 404 `ApiError` when the id matches nothing. `findMany` returns `[]`.
- **A malformed id is not translated.** An id that isn't a valid ObjectId makes Mongoose throw its own `CastError`, which passes through unchanged. Mongoose validation errors do too.
- **`findMany` has defaults but no maximum.** A caller can pass any `limit`. If the value comes from a request, cap it before calling.
- **Connection failure ends the process.** `connectDatabase` calls `process.exit(1)` instead of throwing, so the caller cannot catch the failure, and that path cannot be tested in-process. This suits a server that cannot run without its database.
- **Connection events are logged to the console,** and this cannot be turned off.
- **`strictQuery` is set globally.** `connectDatabase` changes this on the Mongoose instance, which affects every model in the process.
- **This module imports guard-kit.** It is an outward dependency, which is allowed here because it is documented and defended. The defence: db-kit throws guard-kit's errors (a 404 `ApiError` for a missing record, `SetupError` for bad arguments), so api-kit's error handling can turn them into responses with no translation, and guard-kit itself depends on nothing. The cost is that db-kit cannot be copied alone; `guard-kit/` must sit next to it.
- **Not covered:** transactions, population of references, soft deletes, partial field selection, and multiple connections.

## Changes

- **1.1.0** Errors now come from guard-kit: a missing record throws a 404 `ApiError` (it was a plain `Error`), and bad `fields` or `model` arguments throw `SetupError`. An empty `fields` object is now accepted. Added the dependency on guard-kit.
- **1.0.0** Initial version: `connectDatabase`, `disconnectDatabase`, `isConnected`, `createSchema`, `buildRepository`.

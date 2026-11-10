# db-kit

## What it does

Reusable MongoDB plumbing for Mongoose projects:

- **Connection:** connect, disconnect, and check connection status, with the URI supplied by the caller
- **Schema defaults:** `createSchema(fields)` builds a Mongoose schema with shared options already applied (timestamps, clean JSON output)
- **Repository:** `buildRepository(model)` gives any Mongoose model the same five operations (find many, find one, create, update, remove)

It knows nothing about your fields, your models, or your environment. The URI, the field definitions, and the model are all passed in by the caller.

## Install

Copy the `db-kit/` folder into your project, then install Mongoose:

```bash
npm install mongoose
```

You also need a running MongoDB (local or a hosted one such as Atlas) and its connection string.

## Usage

Save this as `try-db.js` next to the `db-kit/` folder. The URI comes from the caller (here, an environment variable), never from the module.

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
    console.log('after remove:', err.message); // record not found
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
Connects the default Mongoose connection to `uri`. It waits up to 10 seconds to find a server, and logs `MongoDB Connected: <name>` when it succeeds. On the first call it also attaches listeners that log `connected` and `disconnected` events. It sets Mongoose's `strictQuery` option to `true`.

If the connection fails, it logs `Couldn't connect to MongoDB: <reason>` and **ends the process with exit code 1**.

#### `disconnectDatabase()` → `Promise<void>`
Closes the default connection.

#### `isConnected()` → `boolean`
`true` only when the connection is fully open.

### `createSchema(fields, [options])` → `mongoose.Schema`

| Param | Type | Notes |
|---|---|---|
| `fields` | object | Your field definitions, passed straight to `new mongoose.Schema`. Must be a non-empty object. |
| `options` | object | Schema options. Anything you pass overrides the defaults below. |

Defaults applied:

| Option | Default |
|---|---|
| `timestamps` | `true` (adds `createdAt` and `updatedAt`) |
| `toJSON` | `virtuals: true`, `versionKey: false`, and `_id` is replaced by `id` |
| `toObject` | `virtuals: true` |

Throws `db-kit: no or invalid fields in createSchema` if `fields` is missing, not an object, or empty.

### `buildRepository(model)` → `{ findMany, findOne, create, update, remove }`

`model` must be a Mongoose model (the result of `mongoose.model(...)`). Throws `db-kit: invalid mongoose model in repository` for anything else.

| Method | Returns | Behavior |
|---|---|---|
| `findMany([filter], [sort], [{ limit, skip }])` | `Promise<Document[]>` | Defaults: `filter = {}`, `sort = { createdAt: -1 }` (newest first), `limit = 20`, `skip = 0`. Returns an empty array when nothing matches. |
| `findOne(id)` | `Promise<Document>` | Finds one record **by id**. Throws `record not found` if there is none. |
| `create(data)` | `Promise<Document>` | Creates and returns the new record. Schema validation errors are thrown by Mongoose. |
| `update(id, data)` | `Promise<Document>` | Updates by id, runs the schema's validators, and returns the **updated** record. Throws `record not found` if there is none. |
| `remove(id)` | `Promise<Document>` | Deletes by id and returns the **deleted** record. Throws `record not found` if there is none. |

## Decisions

- **Everything project-specific is passed in.** The URI, the fields, and the model are parameters. The module never reads `process.env` and never imports a model from your app.
- **Mongoose is required inside the module.** The host project must have it installed. `buildRepository` checks that the model is an instance of *this* copy of Mongoose, so the app and db-kit must resolve to the same installed Mongoose. Declaring it as a peer dependency in your `package.json` prevents two copies.
- **Schema defaults are overridable, but shallowly.** Your `options` are spread last, so any option you give wins. That includes `toJSON`: passing your own `toJSON` replaces the whole default `toJSON` object, so you lose the `id` conversion unless you add it back.
- **`findOne` takes an id, not a filter.** It uses `findById` underneath. The name matches the router in api-kit, but note that it differs from Mongoose's own `findOne`, which takes a filter.
- **A malformed id is not translated.** An id that isn't a valid ObjectId makes Mongoose throw its own `CastError`, which passes through unchanged.

## Changes

- **1.0.0** Initial version: `connectDatabase`, `disconnectDatabase`, `isConnected`, `createSchema`, `buildRepository`.
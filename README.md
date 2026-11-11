# my_indolent_devkit

Reusable Node.js modules for future projects: authentication, MongoDB access, an Express API layer, a fetch client, and a shared error and validation kit.

Until now, code was written for one project, where the author was the only caller and could change both sides at will. These modules are written for projects that don't exist yet, called by someone who has forgotten the details. So the work here is mostly the interface, the documentation, and the tests that make it safe to change.

## The modules

| Module | What it gives you | Library dependencies | Needs guard-kit |
|---|---|---|---|
| [`guard-kit`](guard-kit/README.md) | Error classes (`ApiError`, `SetupError`) and input validation | none | n/a |
| [`auth-kit`](auth-kit/README.md) | Password hashing and rehash detection, JWT signing and verifying, token storage | `bcryptjs`, `jsonwebtoken` | yes |
| [`db-kit`](db-kit/README.md) | MongoDB connection, schema defaults, a repository that works with any model | `mongoose` | yes |
| [`api-kit`](api-kit/README.md) | One response envelope, an async wrapper, a reusable CRUD router | `express` | yes |
| [`api-client-kit`](api-client-kit/README.md) | A `fetch` wrapper with auth, timeouts, and consistent errors | none (Node's built-in `fetch`) | yes |

Each module folder holds `index.js`, a `README.md` (what it does, install, usage, API, decisions, changes), and a `tests/` folder.

## How they fit together

```
auth-kit ───────┐
db-kit ─────────┤
api-kit ────────┼──▶ guard-kit   (depends on nothing)
api-client-kit ─┘
```

The four kits do not import each other. Their only shared dependency is guard-kit, whose errors let one error handler serve the whole toolkit: a missing record from db-kit, a bad token from auth-kit, and a failed request from api-client-kit are all the same kind of error with a `statusCode`. Every module's README defends that dependency in its Decisions section.

Anything project-specific is passed in by the caller: auth-kit takes the secret, db-kit takes the URI and the model, api-kit takes the controller and the auth middleware, and api-client-kit takes the base URL and a function that returns the token.

## Requirements

- **Node 18 or newer.** The client uses the built-in `fetch`, and guard-kit uses the `cause` option of `Error`.
- **MongoDB**, only if you use db-kit against a real database. The tests do not need one.

## Getting started

```bash
npm install
npm test
```

`npm test` runs every module's tests. It needs no database, no `.env` file, and no network.

## Putting it together

A small API protected with auth-kit, built with api-kit, and called with api-client-kit. Save this as `try-devkit.js` in the repo root and run `node try-devkit.js`:

```js
const express = require('express');
const createAuth = require('./auth-kit');
const { buildRouter, sendSuccess, sendCreated } = require('./api-kit');
const createClient = require('./api-client-kit');
const { isApiError } = require('./guard-kit');

// auth-kit: the secret is passed in, never read from the environment
const auth = createAuth('change-me-to-a-long-random-secret', { timer: '1h' });

// A controller: plain functions that take (req, res). Here the data lives in an array.
const items = [];
const controller = {
  async findMany(req, res) {
    return sendSuccess(res, items);
  },
  async create(req, res) {
    const item = { id: items.length + 1, ...req.body };
    items.push(item);
    return sendCreated(res, item);
  },
};
const routes = [
  { method: 'get', path: '/', func: 'findMany' },
  { method: 'post', path: '/', func: 'create' },
];

// api-kit takes any middleware as auth. This one is built from auth-kit.
function requireAuth(req, res, next) {
  try {
    req.user = auth.verifyToken((req.get('authorization') || '').replace('Bearer ', ''));
    next();
  } catch (err) {
    next(err); // auth-kit throws a guard-kit ApiError with status 401
  }
}

const app = express();
app.use(express.json());
app.use('/items', buildRouter(controller, { auth: requireAuth, routes }));
app.use((err, req, res, next) => {
  res.status(isApiError(err) ? err.statusCode : 500).json({ success: false, error: err.message });
});

const server = app.listen(0, async () => {
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  // api-client-kit: the token comes from a function the caller supplies
  const token = auth.signToken({ sub: 'demo-user' });
  const api = createClient(baseUrl, { getToken: () => token });

  console.log(await api.post('/items', { name: 'fern' })); // { success: true, data: { id: 1, name: 'fern' } }
  console.log(await api.get('/items'));                    // { success: true, data: [ { id: 1, name: 'fern' } ] }

  try {
    await createClient(baseUrl).post('/items', { name: 'moss' }); // no token
  } catch (err) {
    console.log(err.statusCode, err.message); // 401 Invalid token
  }

  server.close();
  server.closeAllConnections();
});
```

To add a database, build a controller whose functions call a db-kit repository (`buildRepository(model)`), as described in [db-kit's README](db-kit/README.md).

## Using one module in another project

1. Copy the module's folder into the other project.
2. Copy `guard-kit/` next to it (every module except guard-kit itself imports it as `../guard-kit`).
3. Install the libraries listed for that module in the table above.
4. Follow the Usage example in the module's README.

The question each module is built to pass: could this folder be copied into an unrelated project and used without editing a file?

## Tests

Tests use Node's built-in test runner (`node:test`), so there is nothing extra to install. There is one test file per module, at `<module>/tests/<module>.test.js`, and each has three groups:

- **Success cases:** the documented behavior works.
- **Failure cases:** bad input and failing dependencies produce the documented errors.
- **Contract tests:** the module exports exactly what its README lists, its defaults match the README, and it depends only on the libraries and modules it says it does (checked by reading its source for `require` calls and `process.env`).

| Module | Tests |
|---|---|
| guard-kit | 20 |
| auth-kit | 17 |
| db-kit | 16, plus 3 that only run against a real MongoDB |
| api-kit | 16 |
| api-client-kit | 18 |

Things that would need a network or a database are faked or run locally:
- **db-kit** tests build real Mongoose schemas and models, and replace the model's query methods with fakes.
- **api-kit** and **api-client-kit** tests start a real Express server on a free port and call it over HTTP.
- **db-kit's real-database tests** only run when `MONGO_URI` is set. Put it in a `.env` file and run:

```bash
npm run test:db
```

To run one module's tests: `node --test auth-kit/tests/auth-kit.test.js`.

## Repository layout

```
my_indolent_devkit/
├── guard-kit/
│   ├── index.js
│   ├── README.md
│   └── tests/guard-kit.test.js
├── auth-kit/
│   ├── index.js
│   ├── README.md
│   └── tests/auth-kit.test.js
├── db-kit/
│   ├── index.js
│   ├── README.md
│   └── tests/db-kit.test.js
├── api-kit/
│   ├── index.js
│   ├── README.md
│   └── tests/api-kit.test.js
├── api-client-kit/
│   ├── index.js
│   ├── README.md
│   └── tests/api-client-kit.test.js
├── package.json
└── README.md
```

## Known limits

Each module's README lists its own "Not covered" items in Decisions. The ones worth knowing across the toolkit:

- **db-kit ends the process** if it cannot connect, instead of throwing, so a failed connection cannot be caught.
- **db-kit uses one default connection,** so it cannot talk to two databases at once.
- **Status `0` means "no response"** in api-client-kit, which relies on guard-kit accepting any integer status code.
- **Copying one module alone is not enough.** Each kit other than guard-kit needs `guard-kit/` beside it.
- **There is no password-strength, refresh-token, retry, or request-cancellation support.** These were left out on purpose to keep each interface small.

## License

MIT. See [LICENSE](LICENSE).

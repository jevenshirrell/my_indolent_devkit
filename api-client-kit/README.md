# api-client-kit

## What it does

A small wrapper around `fetch` for talking to a JSON API:

- **One client per API.** `createClient(baseUrl, options)` returns `get`, `post`, `put`, `patch`, `delete`, and a general `request`.
- **JSON in, JSON out.** Request bodies are stringified, responses are parsed.
- **Auth without storage.** If you give it a `getToken` function, it sends `Authorization: Bearer <token>` on every request.
- **Errors you can handle in one way.** A failed request throws a guard-kit `ApiError` with the server's status, message, and details. Timeouts and network failures throw an `ApiError` too, with status `0`.

It reads nothing from your environment or from browser storage. The base URL, the token source, and the headers are all passed in by the caller. Its errors come from guard-kit, the one other module it depends on.

## Install

Copy the `api-client-kit/` folder into your project **next to the `guard-kit/` folder**, because api-client-kit imports it as `../guard-kit`. There is nothing to `npm install`. It needs Node 18 or newer, which has `fetch` built in.

## Usage

Save this as `try-client.js` next to the `api-client-kit/` and `guard-kit/` folders and run `node try-client.js`. It starts a tiny local server so it runs with no network or setup.

```js
const http = require('http');
const createClient = require('./api-client-kit');
const { isApiError } = require('./guard-kit');

// A tiny stand-in server so this example runs on its own.
const items = [{ id: '1', name: 'fern' }];
const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (chunk) => (raw += chunk));
  req.on('end', () => {
    const send = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.method === 'GET' && req.url.startsWith('/items')) {
      return send(200, { success: true, data: items });
    }
    if (req.method === 'POST' && req.url === '/items') {
      if (req.headers.authorization !== 'Bearer demo-token') {
        return send(401, { success: false, error: 'Unauthorized' });
      }
      const item = { id: String(items.length + 1), ...JSON.parse(raw) };
      items.push(item);
      return send(201, { success: true, data: item });
    }
    send(404, { success: false, error: 'Not found', details: { url: req.url } });
  });
});

server.listen(0, async () => {
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  // The caller supplies the base URL and, if needed, a function that returns the token.
  const api = createClient(baseUrl, { getToken: () => 'demo-token', timeout: 3000 });

  console.log(await api.get('/items', { query: { limit: 5 } }));
  // { success: true, data: [ { id: '1', name: 'fern' } ] }

  console.log(await api.post('/items', { name: 'moss' }));
  // { success: true, data: { id: '2', name: 'moss' } }

  // A non-2xx response throws an ApiError carrying the server's message and details.
  try {
    await api.get('/nope');
  } catch (err) {
    console.log(isApiError(err), err.statusCode, err.message, err.details);
    // true 404 Not found { url: '/nope' }
  }

  // No getToken, so no Authorization header is sent.
  try {
    await createClient(baseUrl).post('/items', { name: 'x' });
  } catch (err) {
    console.log(err.statusCode, err.message);
    // 401 Unauthorized
  }

  // A mistake in how the client is called throws a SetupError.
  try {
    await api.get('items');
  } catch (err) {
    console.log(err.name, '-', err.message);
    // SetupError - api-client: path must be a string starting with '/' (got string)
  }

  server.close();
});
```

In a real project, pass the token from wherever you keep it. For example, with auth-kit's token storage (api-client-kit does not import auth-kit; you connect them):

```js
const store = auth.createTokenStorage();
const api = createClient('https://api.example.com', { getToken: () => store.getToken() });
```

## API

### `createClient(baseUrl, [options])` → `{ request, get, post, put, patch, delete }`

The module's export is the `createClient` function itself: `const createClient = require('./api-client-kit')`.

| Param | Type | Default | Notes |
|---|---|---|---|
| `baseUrl` | string | required | Non-empty. A trailing `/` is removed. |
| `options.getToken` | function | none | Returns the token, or a falsy value for none. May be sync or async. Called on every request. |
| `options.headers` | object | `{}` | Headers sent with every request. |
| `options.timeout` | integer | `10000` | Milliseconds before a request is aborted. Must be a positive integer. |

Throws a `SetupError` (from guard-kit) if any option is the wrong type.

### Methods

| Method | Meaning |
|---|---|
| `get(path, [options])` | GET |
| `post(path, body, [options])` | POST with a JSON body |
| `put(path, body, [options])` | PUT with a JSON body |
| `patch(path, body, [options])` | PATCH with a JSON body |
| `delete(path, [options])` | DELETE |
| `request(method, path, [options])` | Any of the five methods; the shortcuts call this. `method` is case-insensitive. |

All return a Promise.

**Request options** (the last argument of every method):

| Key | Type | Notes |
|---|---|---|
| `body` | any JSON-safe value | Sent as JSON with `Content-Type: application/json`. A `GET` cannot have a body. (For `post`, `put`, and `patch`, pass the body as the second argument instead.) |
| `query` | object | Added to the URL as a query string. Values that are `null` or `undefined` are skipped. |
| `headers` | object | Headers for this request only. They override every other header, including `Authorization`. |

`path` must be a string starting with `/`. It is added to the end of `baseUrl`.

**Headers**, in the order they are applied (later ones win): `Accept: application/json`, then `options.headers` from `createClient`, then `Authorization: Bearer <token>` (only if `getToken` returned a token), then `Content-Type` (only when there is a body), then the request's own `headers`.

### Return value

The parsed response body. An empty body (for example a `204`) gives `null`. A body that isn't valid JSON is returned as the raw text. The body is returned as is, so with api-kit you get `{ success, data }`.

### Errors

All failures are guard-kit errors, so `isApiError(err)` and `err.statusCode` work on them.

| Situation | Error | `statusCode` | `message` |
|---|---|---|---|
| Server answers with a non-2xx status | `ApiError` | the HTTP status | the body's `error` field if it has one, otherwise the status text; `details` is the body's `details` field, otherwise `null` |
| Request takes longer than `timeout` | `ApiError` | `0` | `api-client: request timed out after <n>ms` |
| No response (network down, refused connection) | `ApiError` | `0` | `api-client: network error (<reason>)` |
| Wrong arguments (bad option, bad method, path without `/`, `GET` with a body) | `SetupError` | none | names the argument and what it received |

For timeouts and network failures the original error is available as `err.cause`.

## Decisions

- **Everything project-specific is passed in.** The base URL, headers, and token source are parameters. The module never reads `process.env` and never touches `localStorage`.
- **The token comes from a function, not a value.** Because `getToken` is called on every request, a token that is refreshed or replaced is picked up without rebuilding the client. It can be async. It also means api-client-kit does not depend on auth-kit or on any storage; the caller connects them.
- **It returns the whole parsed body and does not unwrap `data`.** That keeps the client from assuming a particular server. The cost is that callers read `result.data` themselves when using api-kit.
- **It uses the server's error fields when they exist, but does not require them.** It reads `error` and `details` from the body (api-kit's envelope), and falls back to the status text for anything else. So it is loosely, not strictly, tied to api-kit.
- **Failures reuse guard-kit's `ApiError`.** Server errors, timeouts, and network failures all have one shape, so callers handle them with one check. Status `0` means "no response was received". This relies on guard-kit accepting any integer status; if its status check is limited to 400 to 599, network failures would throw a `SetupError` instead.
- **Calling mistakes are `SetupError`s.** A bad method, a missing `/`, or a body on a `GET` is a developer's bug, so it is treated as one and thrown before any request is sent. Because the methods are `async`, these show up as rejected promises, not synchronous throws.
- **One timeout per client, no retries.** There is no per-request timeout, no automatic retry, and no way for the caller to cancel a request.

## Changes

- **1.0.0** Initial version: `createClient` with `get`, `post`, `put`, `patch`, `delete`, and `request`; token from `getToken`; timeout; guard-kit errors.

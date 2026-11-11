# auth-kit

## What it does

A small, project-independent toolkit for authentication plumbing in Node:

- Hash and compare passwords with bcryptjs
- Detect stored hashes whose cost factor no longer matches your current setting, so you can rehash them on login
- Sign and verify JWTs (HS256)
- Store, read, and clear a token in a storage object you provide (browser `localStorage` by default)

It reads nothing from your environment and imports nothing from your app. Everything project-specific (the secret, the payload, the storage) is passed in by the caller. Its errors come from guard-kit, the one other module it depends on.

## Install

Copy the `auth-kit/` folder into your project **next to the `guard-kit/` folder**, because auth-kit imports it as `../guard-kit`. Then install its two library dependencies:

```bash
npm install bcryptjs jsonwebtoken
```

## Usage

Save this as `try-auth.js` next to the `auth-kit/` and `guard-kit/` folders and run `node try-auth.js`:

```js
const createAuth = require('./auth-kit');
const { isApiError } = require('./guard-kit');

// The caller supplies the secret. The module never reads process.env.
const auth = createAuth('my-long-random-secret', { timer: '1h', saltRounds: 12 });

async function demo() {
  // Passwords
  const hash = await auth.hashPassword('hunter2');
  console.log(await auth.comparePassword('hunter2', hash)); // true
  console.log(await auth.comparePassword('wrong', hash));   // false

  // Rehash detection: a hash made at cost 10 is outdated for an auth set to 12
  console.log(auth.needsRehash(hash)); // false (same cost as current setting)
  const oldHash = await createAuth('my-long-random-secret', { saltRounds: 10 }).hashPassword('hunter2');
  console.log(auth.needsRehash(oldHash)); // true

  // Tokens
  const token = auth.signToken({ sub: 'user-123', role: 'admin' });
  const decoded = auth.verifyToken(token);
  console.log(decoded.sub, decoded.role); // user-123 admin

  // A bad token throws a 401 ApiError from guard-kit
  try {
    auth.verifyToken('not.a.token');
  } catch (err) {
    console.log(isApiError(err), err.statusCode, err.message); // true 401 Invalid token
  }

  // Token storage (pass any object with getItem/setItem/removeItem)
  const data = new Map();
  const fakeStorage = {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, v),
    removeItem: (k) => data.delete(k),
  };
  const store = auth.createTokenStorage({ storage: fakeStorage });
  store.setToken(token);
  console.log(store.getToken() === token); // true
  store.clearToken();
  console.log(store.getToken()); // null
}

demo();
```

In a browser, call `auth.createTokenStorage()` with no arguments and it uses `localStorage`.

## API

### `createAuth(secret, [options])`

Returns an object with the functions below.

| Param | Type | Default | Notes |
|---|---|---|---|
| `secret` | string | required | Non-empty string. Otherwise throws a `SetupError`: `auth-kit: secret must be a non-empty string (got ...)`. |
| `options.timer` | string or number | `'7d'` | Token lifetime, passed to jsonwebtoken as `expiresIn`. |
| `options.saltRounds` | number | `10` | bcrypt cost factor. bcryptjs does not go below 4. |

### `hashPassword(pwd)` → `Promise<string>`
Hashes a password with the configured `saltRounds`. The password is not validated: a non-string makes the promise reject with bcryptjs's error. bcrypt only uses the first 72 bytes of a password, so anything past that is ignored.

### `comparePassword(pwd, hash)` → `Promise<boolean>`
Resolves `true` if the password matches the hash, `false` otherwise. A `hash` that is not a valid bcrypt hash resolves `false`, it does not throw.

### `needsRehash(hash)` → `boolean`
Returns `true` if the cost factor stored in the hash differs from the configured `saltRounds`, `false` if it matches. A string that is not a bcrypt hash returns `true`. A non-string throws bcryptjs's error. Typical use: after a successful `comparePassword` at login, call `needsRehash(storedHash)` and, if true, hash the plaintext again and save the new hash.

### `signToken(payload)` → `string`
Signs the payload object as given with HS256 and the configured `timer`. The module does not add or require any claims (`sub`, `role`, etc.). That's up to the caller.

### `verifyToken(token)` → `object`
Returns the decoded payload (including `iat` and `exp`). Throws a guard-kit `ApiError` with status 401 and message `Invalid token` if the token is expired, forged, malformed, not a string, signed with a different secret, or signed with an algorithm other than HS256. The original jsonwebtoken error is available as `err.cause`.

### `createTokenStorage([options])` → `{ setToken, getToken, clearToken }`

| Param | Type | Default | Notes |
|---|---|---|---|
| `options.storage` | object | `globalThis.localStorage` | Anything with `getItem`, `setItem`, `removeItem`. |
| `options.key` | string | `'userToken'` | Key the token is saved under. |

Throws a `SetupError` with message `auth-kit: no storage` if no storage is available (for example, in Node with no `storage` passed).

- `setToken(tok)` saves the token
- `getToken()` returns the saved token, or `null` if none
- `clearToken()` removes it

## Decisions

- **Secret is a constructor argument.** Passed once to `createAuth` so callers don't repeat it on every call. It's required and positional; everything optional lives in an options object so options can be added later without breaking existing calls.
- **No environment access.** The module never reads `process.env`. The caller decides where the secret comes from. This keeps the module copy-pasteable into any project.
- **Payload is caller-defined.** `signToken` doesn't assume a user shape (`_id`, `role`). Different projects use different claims.
- **Storage is injected.** Node has no `localStorage`, so the storage object is a parameter. This also lets tests use a fake.
- **The algorithm is pinned to HS256** when signing and when verifying, so a token cannot pick its own algorithm.
- **`verifyToken` collapses every failure into one 401** with the original error attached as `cause`. Callers cannot tell an expired token from a forged one without reading `cause`, which keeps the response the same either way.
- **Rehash means "cost differs", not "cost is lower".** `needsRehash` returns `true` whenever the stored cost is not equal to `saltRounds`, so a hash with a *higher* cost than the current setting is also flagged. This keeps all hashes at one consistent cost.
- **Passwords and hashes are not validated.** An empty password is hashed like any other. bcryptjs rejects non-strings on its own, and silently ignores bytes past 72.
- **This module imports guard-kit.** It is an outward dependency, which is allowed here because it is documented and defended. The defence: auth-kit throws guard-kit's `SetupError` for setup mistakes and `ApiError` for a bad token, so an error handler (such as the one in api-kit's usage) turns it into a 401 with no translation, and guard-kit itself depends on nothing. The cost is that auth-kit cannot be copied alone; `guard-kit/` must sit next to it.
- **Not covered:** refresh tokens, token revocation, password strength rules, and other signing algorithms.

## Changes

- **1.1.0** Errors now come from guard-kit: `verifyToken` throws a 401 `ApiError`, and setup mistakes (bad secret, no storage) throw `SetupError`. Added the dependency on guard-kit.
- **1.0.0** Initial version: `hashPassword`, `comparePassword`, `needsRehash`, `signToken`, `verifyToken`, `createTokenStorage`.

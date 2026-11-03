# auth-kit

## What it does

A small, project-independent toolkit for authentication plumbing in Node:

- Hash and compare passwords with bcryptjs
- Detect stored hashes whose cost factor no longer matches your current setting, so you can rehash them on login
- Sign and verify JWTs (HS256)
- Store, read, and clear a token in a storage object you provide (browser `localStorage` by default)

It reads nothing from your environment and imports nothing from your app. Everything project-specific (the secret, the payload, the storage) is passed in by the caller.

## Install

Copy the `auth-kit/` folder into your project, then install its two library dependencies:

```bash
npm install bcryptjs jsonwebtoken
```

## Usage

```js
const createAuth = require('./auth-kit');

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
| `secret` | string | required | Non-empty string. Throws `auth-kit: secret must be a non-empty string` otherwise. |
| `options.timer` | string or number | `'7d'` | Token lifetime, passed to jsonwebtoken as `expiresIn`. |
| `options.saltRounds` | number | `10` | bcrypt cost factor. |

### `hashPassword(pwd)` → `Promise<string>`
Hashes a password with the configured `saltRounds`.

### `comparePassword(pwd, hash)` → `Promise<boolean>`
Resolves `true` if the password matches the hash, `false` otherwise.

### `needsRehash(hash)` → `boolean`
Returns `true` if the cost factor stored in the hash differs from the configured `saltRounds`, `false` if it matches. Throws if `hash` is not a valid bcrypt hash (this comes from bcryptjs's `getRounds`). Typical use: after a successful `comparePassword` at login, call `needsRehash(storedHash)` and, if true, hash the plaintext again and save the new hash.

### `signToken(payload)` → `string`
Signs the payload object as given with HS256 and the configured `timer`. The module does not add or require any claims (`sub`, `role`, etc.). That's up to the caller.

### `verifyToken(token)` → `object`
Returns the decoded payload (including `iat` and `exp`). Throws `Error('Invalid token')` if the token is expired, forged, malformed, or signed with a different secret. The original error is available as `err.cause`.

### `createTokenStorage([options])` → `{ setToken, getToken, clearToken }`

| Param | Type | Default | Notes |
|---|---|---|---|
| `options.storage` | object | `globalThis.localStorage` | Anything with `getItem`, `setItem`, `removeItem`. |
| `options.key` | string | `'userToken'` | Key the token is saved under. |

Throws `auth-kit: no storage` if no storage is available (for example, in Node with no `storage` passed).

- `setToken(tok)` saves the token
- `getToken()` returns the saved token, or `null` if none
- `clearToken()` removes it

## Decisions

- **Secret is a constructor argument.** Passed once to `createAuth` so callers don't repeat it on every call. It's required and positional; everything optional lives in an options object so options can be added later without breaking existing calls.
- **No environment access.** The module never reads `process.env`. The caller decides where the secret comes from. This keeps the module copy-pasteable into any project.
- **Payload is caller-defined.** `signToken` doesn't assume a user shape (`_id`, `role`). Different projects use different claims.
- **Storage is injected.** Node has no `localStorage`, so the storage object is a parameter. This also lets tests use a fake.
- **Errors from `verifyToken` are collapsed into one message** with the original attached as `cause`.

## Changes

- **1.0.0** Initial version: `hashPassword`, `comparePassword`, `needsRehash`, `signToken`, `verifyToken`, `createTokenStorage`.
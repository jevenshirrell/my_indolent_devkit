# guard-kit

## What it does

Shared error classes and input validation for the other modules in the toolkit (and for any project):

- **Two kinds of error.** `ApiError` is a request-time problem with an HTTP status (bad input, bad token, missing record). `SetupError` is a developer mistake caught at startup (empty secret, malformed route table).
- **Validation rules and checks.** Small rules like `validate.nonEmptyString` plus `createGuard(prefix)`, which gives you checks that throw the right kind of error with messages starting with your module name.
- **One structured check.** `validateObject` tests several fields at once and reports every problem together.

It has no dependencies and imports nothing from your app or from another module.

## Install

Copy the `guard-kit/` folder into your project. There is nothing to `npm install`. It needs Node 16.9 or newer (it uses the `cause` option of `Error` and class fields).

## Usage

Save this as `try-guard.js` next to the `guard-kit/` folder and run `node try-guard.js`:

```js
const { ApiError, isApiError, validate, oneOf, optional, startsWith, createGuard } = require('./guard-kit');

// Each module makes one guard, with its own name, at the top of its file.
const guard = createGuard('my-app');

function attempt(label, fn) {
  try {
    fn();
    console.log(`${label}: ok`);
  } catch (err) {
    console.log(`${label}: ${err.name} (status ${err.statusCode ?? 'none'}) - ${err.message}`);
    if (err.details) console.log('  details:', err.details);
  }
}

// 1. A developer mistake, caught at startup -> SetupError
attempt('secret', () => guard.expect('', 'secret', validate.nonEmptyString, { setup: true }));

// 2. A caller mistake: every problem is reported together -> ApiError 400
attempt('body', () =>
  guard.validateObject(
    { age: 'ten', role: 'boss', path: 'items' },
    {
      name: validate.nonEmptyString,
      age: validate.integer,
      role: oneOf(['admin', 'user']),
      path: startsWith('/'),
      nickname: optional(validate.nonEmptyString),
    }
  )
);

// 3. A custom condition
attempt('custom', () => guard.assert(1 > 2, 'Start date must be before end date', { field: 'startDate' }));

// 4. Valid input passes without a sound
attempt('valid', () => guard.expect(['a'], 'tags', validate.nonEmptyArray));

// 5. Throwing a specific error yourself, keeping the original as the cause
const original = new Error('E11000 duplicate key');
const err = ApiError.conflict('Email already in use', { details: { field: 'email' }, cause: original });
console.log(err.statusCode, err.details, err.cause === original, isApiError(err)); // 409 { field: 'email' } true true

// 6. Turning errors into responses (in an Express app, this is your error middleware)
function errorHandler(error, req, res, next) {
  if (isApiError(error)) {
    return res.status(error.statusCode).json({ success: false, error: error.message, details: error.details });
  }
  console.error(error); // SetupError or a bug: log it, but never show the client
  res.status(500).json({ success: false, error: 'Internal Server Error' });
}
```

## API

### Errors

All errors have `message`, `name` (the class name), `details`, and `cause`. All are `instanceof Error` and `instanceof GuardError`.

#### `new ApiError(statusCode, message, [options])`
A request-time error. Has `statusCode` and `isOperational: true`. Throws a `SetupError` if `statusCode` is not an integer. The range is not checked, so any integer is accepted.

#### Factories
Each builds an `ApiError`. All take `(message, [options])` and have a default message.

| Factory | Status | Default message | Use for |
|---|---|---|---|
| `ApiError.badRequest` | 400 | `Bad Request` | malformed or invalid input |
| `ApiError.unauthorized` | 401 | `Unauthorized` | not logged in, bad credentials or token |
| `ApiError.forbidden` | 403 | `Forbidden` | logged in but not allowed |
| `ApiError.notFound` | 404 | `Not Found` | the resource doesn't exist |
| `ApiError.conflict` | 409 | `Conflict` | valid request that clashes with current state (e.g. duplicate) |

#### `options`
| Key | Type | Notes |
|---|---|---|
| `details` | any JSON-safe value | Structured information about what went wrong (for example, which fields failed). Safe to send to a client. Default `null`. |
| `cause` | Error | The original low-level error. For logs only. Never send it to a client. |

#### `new SetupError(message, [options])`
A developer mistake. `isOperational: false`, no `statusCode`. Takes the same `options` as above.

#### `GuardError`
The base class of both. Useful for `instanceof GuardError` when you want to catch any error from this kit.

#### `isApiError(err)` → `boolean`
`true` for an `ApiError`, `false` for anything else (a `SetupError`, a plain `Error`, `null`). It checks the error's shape (name, `isOperational`, integer `statusCode`) rather than using `instanceof`, so it works even if two copies of guard-kit are loaded.

### Rules

A rule is a function `(value) => boolean` with a `label` used in messages.

| Rule | Passes when the value is |
|---|---|
| `validate.nonEmptyString` | a string with at least one character |
| `validate.string` | a string (including empty) |
| `validate.function` | a function |
| `validate.array` | an array |
| `validate.nonEmptyArray` | an array with at least one item |
| `validate.object` | a plain object (not `null`, not an array) |
| `validate.integer` | an integer |
| `validate.positiveInteger` | an integer greater than 0 |
| `oneOf(list)` | included in `list` |
| `startsWith(prefix)` | a string that starts with `prefix` |
| `optional(rule)` | `undefined`, or passes `rule` |

#### `rule(label, fn)` → `fn`
Attaches `label` to the function `fn` and returns it, so you can write your own rules: `rule('an even number', (v) => v % 2 === 0)`.

#### `describe(value)` → `string`
Names what a value is, for messages: `'null'`, `'an empty string'`, `'an array'`, or its `typeof`.

### `createGuard([prefix])` → `{ assert, assertSetup, expect, validateObject }`

Messages start with `"<prefix>: "` when a prefix is given.

#### `assert(condition, message, [details])`
If `condition` is falsy, throws `ApiError` 400 with `message` and `details`. Use for the caller's mistakes.

#### `assertSetup(condition, message)`
If `condition` is falsy, throws a `SetupError`. Use for the developer's mistakes.

#### `expect(value, name, rule, [{ setup }])`
Checks one value against one rule. On failure, throws with the message `"<name> must be <rule label> (got <what it was>)"`. Throws a `SetupError` if `setup` is `true`, otherwise an `ApiError` 400.

#### `validateObject(value, rules, [{ setup }])`
Checks every field in `rules` (an object mapping field name to rule) against `value`. If any fail, throws once:
- request mode (default): `ApiError` 400 with message `Validation failed` and `details` listing each failing field
- `setup: true`: `SetupError` whose message lists every problem, with the same `details`

If `value` or `rules` is not a plain object, it always throws a `SetupError`, whatever the `setup` option.

## Decisions

- **Two kinds of error, split by whose fault it is.** `ApiError` means the caller sent something wrong, and is expected (`isOperational: true`). `SetupError` means the developer used a module wrong, and is a bug (`isOperational: false`). An error handler can show the first kind to clients and treat the second as a generic 500.
- **`details` and `cause` are separate on purpose.** `details` is for the client. `cause` keeps the original library error for logs. Mixing them would risk leaking internals.
- **The taxonomy is built on HTTP status codes,** even though auth-kit and db-kit are not HTTP libraries. The benefit is that api-kit's error handler can turn any error into a response without translating. The cost is that a database module throws a "404". The alternative would be neutral error codes that api-kit maps itself.
- **Factories take an options object `{ details, cause }`,** matching the constructor, so a caller can attach a cause without extra arguments.
- **`isApiError` checks shape, not `instanceof`.** Copying the folder into several places can load two copies of this module, and `instanceof` would fail across them.
- **Rules carry a label, and `rule` is exported.** Every check can build a readable message ("must be a non-empty string (got an empty string)") without each call site writing its own, and callers can add rules this module does not know about.
- **`createGuard(prefix)` binds the module name once.** Each module creates its own guard at the top of its file, so messages say which module complained without repeating the name.
- **`validateObject` reports all problems at once,** not just the first, so a caller fixes everything in one pass.
- **Status codes are only checked to be integers.** The range (400 to 599) is not enforced, so `new ApiError(200, ...)` is accepted. api-client-kit relies on this: it uses status `0` to mean "no response was received". Use the factories for the standard statuses.
- **A non-object `value` or `rules` in `validateObject` is always a `SetupError`,** even in request mode. That means a request body that isn't an object (for example `undefined`) produces a `SetupError`, which a handler would treat as a 500. Check the body with `expect(body, 'body', validate.object)` first if you want a 400.
- **No dependencies.** This is a leaf module. Any module that imports it gains an outward dependency, which that module's README must document and defend.
- **Not covered:** format checks (email, URL, regex), nested object validation, and type coercion. Write a custom rule with `rule`, or use `assert` with your own condition, for those.

## Changes

- **1.1.0** Added the `startsWith` rule, and exported `rule` and `describe` so callers can write their own rules. The status code check is integer-only. A `value` or `rules` that is not a plain object is always reported as a `SetupError`.
- **1.0.0** Initial version: `GuardError`, `ApiError` with five factories, `SetupError`, `isApiError`, rules (`validate`, `oneOf`, `optional`), and `createGuard` with `assert`, `assertSetup`, `expect`, and `validateObject`.

# padvinder

A tiny, CSP-safe JSONPath engine for JavaScript. **~2.75KB min+gzip, zero dependencies. Passes all 456 valid-selector cases of the official RFC 9535 compliance suite.**

[![NPM version](https://img.shields.io/npm/v/padvinder.svg)](https://www.npmjs.com/package/padvinder)
[![Build Status](https://github.com/robinvdvleuten/padvinder/actions/workflows/test.yml/badge.svg)](https://github.com/robinvdvleuten/padvinder/actions/workflows/test.yml)
[![NPM downloads](https://img.shields.io/npm/dm/padvinder.svg)](https://www.npmjs.com/package/padvinder)
[![MIT license](https://img.shields.io/github/license/robinvdvleuten/padvinder.svg)](https://github.com/robinvdvleuten/padvinder/blob/main/LICENSE)

<a href="https://webstronauts.com?utm_source=github&utm_medium=readme&utm_campaign=padvinder">
	<picture>
		<img src="https://webstronauts.com/images/sponsored-by.svg" alt="Sponsored by The Webstronauts" width="200" height="65">
	</picture>
</a>

*Padvinder* is Dutch for "pathfinder", and also what we call a scout. It implements RFC 9535 JSONPath, filters included, with a real parser instead of the generated code that filter evaluation usually relies on. There is no `eval` and no `new Function`, so a query cannot smuggle code into your application, and the engine runs under a strict Content Security Policy.

```js
import { query, find } from 'padvinder';

const data = {
  store: {
    book: [
      { title: 'Sayings of the Century', price: 8.95, category: 'reference' },
      { title: 'Sword of Honour', price: 12.99, category: 'fiction' },
      { title: 'Moby Dick', price: 8.99, category: 'fiction' },
    ],
  },
};

// One-shot:
find('$..book[?@.price < 10].title', data);
// => ['Sayings of the Century', 'Moby Dick']

// Compile once, run many times:
const cheap = query('$.store.book[?@.price < 10 && @.category == "fiction"].title');
cheap(data); // => ['Moby Dick']

// Register your own filter functions:
find('$..book[?sale(@)].title', data, { sale: b => b.price < 9 });
```

## API

### `query(path, functions?)`

Compiles the query and returns a runner `(data) => matches[]`. Malformed paths and invalid filter expressions throw a `SyntaxError` at compile time. A query that matches nothing returns an empty array.

### `find(path, data, functions?)`

Shorthand for `query(path, functions)(data)`.

## Syntax

| Selector | Meaning |
| --- | --- |
| `$` | The root |
| `.name`, `['name']` | Child property |
| `[0]`, `[-1]` | Array index, negatives count from the end |
| `[1:3]`, `[:2]`, `[-2:]`, `[0:4:2]` | Array slice, with optional positive step |
| `.*`, `[*]` | All children |
| `..name` | Recursive descent: `name` anywhere below |
| `[0,2]`, `['a','b']` | Union of selectors |
| `[?expr]`, `[?(expr)]` | Keep children matching the filter (see below) |

## Filters

Filters follow the RFC 9535 grammar. Comparisons (`==`, `!=`, `<`, `<=`, `>`, `>=`), the logical operators `&&`, `||`, and `!`, and parentheses combine two kinds of operand: literals and *queries*. A bare query is an existence test, so `[?@.a]` keeps children that have an `a`, including a present `null`. A query used in a comparison is read for its value, and a missing path compares as "nothing" rather than throwing, so `[?@.a.b == 1]` is safe even when `a` is absent. `==` is deep structural equality.

```js
find('$.store.book[?@.price < 10]', data);
find('$.store.book[?@.price > $.store.bicycle.price]', data);           // $ is the root
find('$.store.book[?@.category == "fiction" && @.price < 20]', data);
find('$.store.book[?!@.sale]', data);
```

Five functions ship built in: `length()`, `count()`, `value()`, and the regular-expression tests `match()` (full match) and `search()` (substring). Register your own for anything else, and call them from a filter with `@` as the current node:

```js
find('$.book[?length(@.title) > 20]', data);
find('$.book[?match(@.isbn, "[0-9]{13}")]', data);
find('$.book[?luhn(@.code)]', data, { luhn: valid });                   // your function
```

## Content Security Policy

padvinder works under `script-src 'self'` with no `unsafe-eval`. Paths and filters compile to a chain of closures. Query text is never turned into JavaScript.

This matters for JSONPath specifically because filter expressions are the classic weak spot: jsonpath-plus evaluated them by executing generated code, which led to remote code execution via crafted queries ([CVE-2024-21534](https://nvd.nist.gov/vuln/detail/CVE-2024-21534)) and follow-up bypasses. padvinder's filters go through a parser that has no route to code execution, so a hostile query can, at worst, return the wrong nodes or throw. The test suite runs under `node --disallow-code-generation-from-strings`, which throws on any string-to-code construct the same way a strict CSP does.

## Safety

- Queries read the data you pass in and never modify it.
- `__proto__`, `constructor`, and `prototype` never match, in paths or in filters. Prototype-chain properties are invisible: matching is own-properties only, so a filter like `[?@.constructor]` finds nothing rather than reaching `Object.prototype`.
- Registered functions resolve only from what you provide, and receive plain data values as arguments.

## License

MIT © [Robin van der Vleuten](https://robinvdvleuten.nl)

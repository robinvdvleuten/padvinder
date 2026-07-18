# padvinder

A tiny, CSP-safe JSONPath engine for JavaScript. **~1.2KB min+gzip (~2.5KB with [xprsn](https://www.npmjs.com/package/xprsn)), one dependency.**

*Padvinder* is Dutch for "pathfinder", and also what we call a scout. It runs JSONPath queries where every `?(...)` filter is a full [xprsn](https://github.com/robinvdvleuten/xprsn) expression, parsed by a real parser instead of handed to JavaScript. There is no `eval` and no `new Function`, so a query cannot smuggle code into your application, and the engine runs under a strict Content Security Policy.

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
find('$..book[?(@.price < 10)].title', data);
// => ['Sayings of the Century', 'Moby Dick']

// Compile once, run many times:
const cheap = query('$.store.book[?(@.price < 10 and @.category == "fiction")].title');
cheap(data); // => ['Moby Dick']

// Custom functions inside filters:
find('$..book[?(sale(@))].title', data, { sale: b => b.price < 9 });
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
| `[?(expr)]` | Keep children where the filter expression is truthy |

## Filters

A filter is an [xprsn expression](https://github.com/robinvdvleuten/xprsn#syntax) with two extra variables: `@` is the candidate node and `$` is the root. That buys you more than most JSONPath implementations offer, including method calls, arithmetic, and null-safe access:

```js
find('$.store.book[?(@.title.startsWith("S"))]', data);
find('$.store.book[?(@.price > $.store.bicycle.price)]', data);
find('$.users[?(@.profile?.verified ?? false)]', data);
find('$.items[?(@.qty * @.price > 100)]', data);
```

Anything the expression language leaves out (regular expressions, say) you add as a registry function: `find('$.a[?(match(@.sku))]', data, { match: s => /^X-/.test(s) })`.

## Content Security Policy

padvinder works under `script-src 'self'` with no `unsafe-eval`. Paths compile to a chain of closures, and filters go through xprsn, which composes closures the same way. Query text is never turned into JavaScript.

This matters for JSONPath specifically because filter expressions are the classic weak spot: jsonpath-plus evaluated them by executing generated code, which led to remote code execution via crafted queries ([CVE-2024-21534](https://nvd.nist.gov/vuln/detail/CVE-2024-21534)) and follow-up bypasses. padvinder's filters go through a parser that has no route to code execution, so a hostile query can, at worst, return the wrong nodes or throw. The test suite runs under `node --disallow-code-generation-from-strings`, which throws on any string-to-code construct the same way a strict CSP does.

## Safety

- Queries read the data you pass in and never modify it.
- `__proto__`, `constructor`, and `prototype` never match, in paths or in filters. Prototype-chain properties are invisible: matching is own-properties only.
- Filter expressions inherit every xprsn guard, and functions resolve only from the registry you provide.

## License

MIT © [Robin van der Vleuten](https://robinvdvleuten.nl)

# padvinder

A tiny, CSP-safe JSONPath engine for JavaScript. **~2.9KB min+gzip (~4.3KB with [xprsn](https://www.npmjs.com/package/xprsn)), one dependency. Passes all 456 valid-selector cases of the official RFC 9535 compliance suite.**

*Padvinder* is Dutch for "pathfinder", and also what we call a scout. It implements RFC 9535 JSONPath, and on top of that accepts any [xprsn](https://github.com/robinvdvleuten/xprsn) expression as a filter, parsed by a real parser instead of handed to JavaScript. There is no `eval` and no `new Function`, so a query cannot smuggle code into your application, and the engine runs under a strict Content Security Policy.

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
| `[?expr]`, `[?(expr)]` | Keep children matching the filter (see below) |

## Filters

Filters speak two grammars, tried in order. A filter that parses as **RFC 9535 grammar** gets RFC semantics: `[?@.a]` is an existence test (it matches a present `null`), comparisons treat missing paths as Nothing instead of throwing, `==` is deep structural equality, subqueries like `count(@.*)` yield nodelists, and the `length()`, `count()`, `value()`, `match()`, and `search()` functions work as specified. Anything else compiles as an **[xprsn expression](https://github.com/robinvdvleuten/xprsn#syntax)** with `@` bound to the candidate node and `$` to the root. That is where method calls, arithmetic, `?.`/`??`, and your own registry functions live:

```js
find('$.store.book[?(@.title.startsWith("S"))]', data);
find('$.store.book[?(@.price > $.store.bicycle.price)]', data);
find('$.users[?(@.profile?.verified ?? false)]', data);
find('$.items[?(@.qty * @.price > 100)]', data);
```

The RFC grammar covers regular expressions through `match()` and `search()`. For anything else, register a function and call it from a filter: `find('$.a[?(luhn(@.card))]', data, { luhn: valid })`. Registry functions only resolve in the xprsn grammar, so a name that shadows an RFC function still reaches the RFC one.

## Content Security Policy

padvinder works under `script-src 'self'` with no `unsafe-eval`. Paths and RFC filters compile to a chain of closures, and xprsn-grammar filters compose closures the same way. Query text is never turned into JavaScript.

This matters for JSONPath specifically because filter expressions are the classic weak spot: jsonpath-plus evaluated them by executing generated code, which led to remote code execution via crafted queries ([CVE-2024-21534](https://nvd.nist.gov/vuln/detail/CVE-2024-21534)) and follow-up bypasses. padvinder's filters go through a parser that has no route to code execution, so a hostile query can, at worst, return the wrong nodes or throw. The test suite runs under `node --disallow-code-generation-from-strings`, which throws on any string-to-code construct the same way a strict CSP does.

## Safety

- Queries read the data you pass in and never modify it.
- `__proto__`, `constructor`, and `prototype` never match, in paths or in filters. Prototype-chain properties are invisible: matching is own-properties only. In an RFC filter a blocked key is simply absent (the child does not match); in an xprsn filter it throws, same as reading it anywhere else.
- xprsn-grammar filters inherit every xprsn guard, and registry functions resolve only from what you provide.

## License

MIT © [Robin van der Vleuten](https://robinvdvleuten.nl)

# padvinder

Tiny, CSP-safe JSONPath engine powered by xprsn expressions. Sibling of xprsn and sjabloon: plain JS + JSDoc, tape, microbundle.

## Commands

- `npm test` — tape suites under `node --disallow-code-generation-from-strings` (strict-CSP simulation).
- `npm run build` — microbundle → `dist/` (ESM/CJS/UMD) + `index.d.ts` from JSDoc. Prints min+gzip sizes.
- Run a single suite: `npx tape test/query.test.js`

## Architecture

The entire implementation is `src/index.js` (~150 lines, one file by design). `query(path)` parses the path into segments; each segment compiles to a closure `(nodes, root) => nodes`, and running a query is a `reduce` over those closures starting from `[data]`. Filters (`?(expr)`) are rewritten by `vars()` (`@` → `_`, `$` → `_root`, skipping string literals) and handed to xprsn's `compile`; the filter closure evaluates with `{ _: candidate, _root: root }` as values. No AST, no code generation.

Bracket contents are scanned by `close()` (matching `]` with nesting and string awareness) and `split()` (top-level commas for unions). `child()`/`kids()` are the only data-access paths.

## Hard constraints

1. **CSP safety is non-negotiable.** Same rules as the siblings: no string-to-code paths, the suite runs under `--disallow-code-generation-from-strings`, and a test scans the source — don't use the words "eval" or "new Function" even in comments.
2. **`child()` and `kids()` are the access boundary.** All data reads go through them; both skip `__proto__`/`constructor`/`prototype` and match own properties only (`Object.hasOwn`). Never add a read path that bypasses them. Blocked keys silently match nothing in paths (queries are search, not access), while xprsn throws inside filters — both are intentional.
3. **Filter expressions go through xprsn's public `compile`, never a local parser.** The `vars()` rewriter must keep skipping string literals so `@` in data values (emails) survives.
4. Queries must never modify the data (a test snapshots and compares).
5. Size is a soft goal (~1.2KB min+gzip on top of xprsn's ~1.4KB).

## Semantics to preserve

- Non-matches return `[]`, never throw: missing keys, out-of-range indexes, wrong node types.
- Compile-time `SyntaxError` for malformed paths and filter expressions; runtime `TypeError` only from xprsn's guards inside filters.
- Negative indexes count from the end; slice steps are positive only.
- `..` applies the following segment to the node and every descendant, in document order.

## Conventions

- Tabs for indentation. Tests in `test/*.test.js` (`query`, `errors`, `safety` suites).
- Do not mention Symfony in code, comments, or docs.
- `dist/` is gitignored; `index.d.ts` is generated from JSDoc — edit the JSDoc in `src/index.js`.

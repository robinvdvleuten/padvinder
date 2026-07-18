# padvinder

Tiny, CSP-safe JSONPath engine powered by xprsn expressions. Sibling of xprsn and sjabloon: plain JS + JSDoc, tape, microbundle.

## Commands

- `npm test` — tape suites under `node --disallow-code-generation-from-strings` (strict-CSP simulation).
- `npm run build` — microbundle → `dist/` (ESM/CJS/UMD) + `index.d.ts` from JSDoc. Prints min+gzip sizes.
- Run a single suite: `npx tape test/query.test.js`

## Architecture

The entire implementation is `src/index.js` (~290 lines, one file by design). `segments(path, j, fns, soft)` parses consecutive segments into closures `(nodes, root) => nodes`; `run()` reduces them over a start nodelist. `query()` calls it in hard mode (`soft` false, errors on junk); the filter compiler calls it in soft mode (stops at the first char that cannot start a segment) to parse embedded queries. No AST, no code generation.

Bracket contents are scanned by `close()` (matching `]` with nesting and string awareness) and `split()` (top-level commas for unions). `child()`/`kids()` are the only data-access paths. Each segment carries a `sing` flag (singular: one name/index selector, not a descendant) that the filter compiler uses to accept or reject a query in ValueType position.

Filters try two grammars, in order (in `selector()`'s `?` branch):
- **RFC 9535** via `rfcFilter()`, a recursive-descent parser (`or`/`and`/`basic`/`primary`) producing `(node, root) => boolean`. Queries run through `segments()`+`run()`; existence tests check nodelist length; `cmp()` implements RFC comparison (deep `==` via `deepEq`, `NOTHING` sentinel for absent singular queries, orderings only for same-typed number/string pairs); the five function extensions live in `RFCFN` with arg/return typing. A parse failure (unknown function, non-singular comparison operand, trailing junk, any non-RFC syntax) throws and routes to the fallback.
- **xprsn** fallback: `vars()` rewrites `@`→`_`, `$`→`_root` (skipping string literals) and xprsn's `compile` runs it. This is the dialect superset where method calls, `?.`/`??`, and the user registry live.

## Hard constraints

1. **CSP safety is non-negotiable.** Same rules as the siblings: no string-to-code paths, the suite runs under `--disallow-code-generation-from-strings`, and a test scans the source — don't use the words "eval" or "new Function" even in comments.
2. **`child()`, `kids()`, and `deepEq()` are the access boundary.** All data reads go through them; each skips `__proto__`/`constructor`/`prototype` and matches own properties only (`Object.hasOwn`). Never add a read path that bypasses them. Blocked keys silently match nothing in paths and RFC filters (search, not access), while xprsn-grammar filters throw — both are intentional.
3. **`rfcFilter()` is a parser over closures, not a source generator.** It builds `(node, root) => boolean` from pre-existing functions; it never emits or runs source text. All expression *evaluation* it does not cover falls back to xprsn's public `compile` (the `vars()` rewriter must keep skipping string literals so `@` in data values like emails survives). The RFC parse must consume the whole filter and fail cleanly (throw) on anything non-RFC, so the fallback is reached instead of a half-applied parse.
4. **The two grammars must not leak into each other.** The five `RFCFN` functions resolve only in RFC filters; the user registry resolves only in the xprsn fallback. Do not merge them.
5. Queries must never modify the data (a test snapshots and compares).
6. Size is a soft goal (~2.9KB min+gzip on top of xprsn's ~1.4KB). The compliance suite (`npm run cts:update`) is the correctness gate, not size.

## Semantics to preserve

- Non-matches return `[]`, never throw: missing keys, out-of-range indexes, wrong node types.
- Compile-time `SyntaxError` for malformed paths and filter expressions; runtime `TypeError` only from xprsn's guards inside fallback filters.
- Negative indexes count from the end; slices follow RFC 9535 (negative steps walk backwards, step 0 selects nothing).
- Bracket keys are RFC-typed: a quoted name selects only from objects, an index only from arrays.
- `..` applies the following segment to the node and every descendant, in document order; `all()` carries an ancestor set so cyclic data cannot hang it.
- RFC filters: existence is present-not-truthy (`[?@.a]` matches `{a: null}`), `==` is deep equality, absent singular queries are `NOTHING`. The compliance suite (`test/cts.json`, BSD-2, notice in `test/cts.LICENSE`) pins all of this; `test/compliance.test.js` must report 456 conformant with an empty `DIALECT` ledger.

## Conventions

- Tabs for indentation. Tests in `test/*.test.js` (`query`, `errors`, `safety` suites).
- Do not mention Symfony in code, comments, or docs.
- `dist/` is gitignored; `index.d.ts` is generated from JSDoc — edit the JSDoc in `src/index.js`.

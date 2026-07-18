# padvinder

Tiny, CSP-safe, zero-dependency RFC 9535 JSONPath engine. Same family and toolchain as xprsn and sjabloon (plain JS + JSDoc, tape, microbundle), but no runtime dependency: the filter grammar is implemented here, not delegated.

## Commands

- `npm test` — tape suites under `node --disallow-code-generation-from-strings` (strict-CSP simulation).
- `npm run build` — microbundle → `dist/` (ESM/CJS/UMD) + `index.d.ts` from JSDoc. Prints min+gzip sizes.
- Run a single suite: `npx tape test/query.test.js`

## Architecture

The entire implementation is `src/index.js` (~290 lines, one file by design). `segments(path, j, fns, soft)` parses consecutive segments into closures `(nodes, root) => nodes`; `run()` reduces them over a start nodelist. `query()` calls it in hard mode (`soft` false, errors on junk); the filter parser calls it in soft mode (stops at the first char that cannot start a segment) to parse embedded queries. No AST, no code generation.

Bracket contents are scanned by `close()` (matching `]` with nesting and string awareness) and `split()` (top-level commas for unions). `child()`/`kids()` are the only data-access paths. Each segment carries a `sing` flag (singular: one name/index selector, not a descendant) that the filter parser uses to accept or reject a query in ValueType position.

Filters are RFC 9535, parsed by `rfcFilter()` in `selector()`'s `?` branch: a recursive-descent parser (`or`/`and`/`basic`/`primary`) producing `(node, root) => boolean`. Queries run through `segments()`+`run()`; a bare query is an existence test (nodelist length); `cmp()` implements RFC comparison (deep `==` via `deepEq`, `NOTHING` sentinel for absent singular queries, orderings only for same-typed number/string pairs). The five built-in function extensions live in `RFCFN` with arg/return typing; a name not in `RFCFN` is looked up in the caller's registry and treated as a function extension taking value-type args (usable as a value or as a truthiness test — the one deliberate step beyond strict RFC, and it never affects the compliance suite, which only exercises the built-ins). A genuinely malformed filter throws `SyntaxError` at compile time; there is no fallback.

## Hard constraints

1. **CSP safety is non-negotiable.** Same rules as the siblings: no string-to-code paths, the suite runs under `--disallow-code-generation-from-strings`, and a test scans the source — don't use the words "eval" or "new Function" even in comments.
2. **`child()`, `kids()`, and `deepEq()` are the access boundary.** All data reads go through them; each skips `__proto__`/`constructor`/`prototype` and matches own properties only (`Object.hasOwn`). Never add a read path that bypasses them. Blocked keys silently match nothing everywhere (queries are search, not access), including inside filters — that is intentional and pinned by the safety suite.
3. **`rfcFilter()` is a parser over closures, not a source generator.** It builds `(node, root) => boolean` from pre-existing functions; it never emits or runs source text. It must consume the whole filter and throw `SyntaxError` on anything non-RFC — there is no fallback, so a malformed filter is a hard error, not a reinterpretation.
4. **Zero runtime dependencies.** This is the point of the package. Do not reintroduce a dependency for filter evaluation; the grammar lives here. `devDependencies` (microbundle, tape) are fine.
5. Queries must never modify the data (a test snapshots and compares).
6. Size is a soft goal (~2.75KB min+gzip). The compliance suite (`npm run cts:update`) is the correctness gate, not size.

## Semantics to preserve

- Non-matches return `[]`, never throw: missing keys, out-of-range indexes, wrong node types.
- Compile-time `SyntaxError` for malformed paths and filters. Filters never throw at runtime; a missing or blocked path is simply absent.
- Negative indexes count from the end; slices follow RFC 9535 (negative steps walk backwards, step 0 selects nothing).
- Bracket keys are RFC-typed: a quoted name selects only from objects, an index only from arrays.
- `..` applies the following segment to the node and every descendant, in document order; `all()` carries an ancestor set so cyclic data cannot hang it.
- RFC filters: existence is present-not-truthy (`[?@.a]` matches `{a: null}`), `==` is deep equality, absent singular queries are `NOTHING`. The compliance suite (`test/cts.json`, BSD-2, notice in `test/cts.LICENSE`) pins all of this; `test/compliance.test.js` must report 456 conformant with an empty `DIALECT` ledger.

## Conventions

- Tabs for indentation. Tests in `test/*.test.js` (`query`, `errors`, `safety` suites).
- Do not mention Symfony in code, comments, or docs.
- `dist/` is gitignored; `index.d.ts` is generated from JSDoc — edit the JSDoc in `src/index.js`.

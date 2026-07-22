# Comparison benchmarks

This manual suite compares padvinder's published build with JSONPath Plus,
jsonpath-rfc9535, and the interpreted and JIT modes from
@jsonjoy.com/json-path. It is for understanding performance trade-offs, not
declaring a universal winner.

## Results (2026-07-22)

One run on Node v24.15.0, macOS arm64. Versions: padvinder 0.3.0,
JSONPath Plus 10.4.0, jsonpath-rfc9535 1.3.0, and jsonjoy 18.28.0. Values
are median operations per second; the parenthesized number is throughput
relative to padvinder.

### Cold compile + run, 100 features

| Query | padvinder | JSONPath Plus | rfc9535 | jsonjoy eval | jsonjoy JIT |
| --- | ---: | ---: | ---: | ---: | ---: |
| Shallow | 195,423 (1.00x) | 126,283 (0.65x) | 286,337 (1.47x) | 961,830 (4.92x) | 241,173 (1.23x) |
| Deep | 74,935 (1.00x) | 36,031 (0.48x) | 79,090 (1.06x) | 216,079 (2.88x) | 108,486 (1.45x) |
| Conditional | 27,412 (1.00x) | 21,396 (0.78x) | 24,119 (0.88x) | 90,067 (3.29x) | 27,665 (1.01x) |
| Descendant | 4,499 (1.00x) | 11,871 (2.64x) | 27,398 (6.09x) | 39,972 (8.89x) | 40,175 (8.93x) |
| Compound | 17,141 (1.00x) | 15,106 (0.88x) | 13,777 (0.80x) | 59,719 (3.48x) | 13,344 (0.78x) |

### Hot run, 1,000 features

| Query | padvinder | JSONPath Plus | rfc9535 | jsonjoy eval | jsonjoy JIT |
| --- | ---: | ---: | ---: | ---: | ---: |
| Shallow | 28,006 (1.00x) | 13,572 (0.48x) | 45,387 (1.62x) | 124,109 (4.43x) | 140,100 (5.00x) |
| Deep | 9,060 (1.00x) | 3,717 (0.41x) | 9,754 (1.08x) | 23,145 (2.55x) | 25,553 (2.82x) |
| Conditional | 3,122 (1.00x) | 2,470 (0.79x) | 2,799 (0.90x) | 10,129 (3.24x) | 16,750 (5.36x) |
| Descendant | 467 (1.00x) | 1,244 (2.66x) | 2,922 (6.26x) | 3,998 (8.56x) | 4,785 (10.25x) |
| Compound | 2,090 (1.00x) | 1,620 (0.78x) | 1,906 (0.91x) | 6,512 (3.12x) | 8,073 (3.86x) |

The native-prepare diagnostic is omitted because the engine APIs do different
amounts of work at that stage.

## Run

Install the isolated benchmark dependencies once:

```sh
npm --prefix bench/comparison install
```

Then run from the repository root:

```sh
npm run bench:comparison
```

The command builds padvinder before benchmarking `dist/index.js`. Competitor
dependencies live under this directory, so a normal root install and CI do not
install them.

## Measurements

- **Cold compile + run** measures parsing or compilation and one execution.
- **Hot run** prepares each query before timing repeated execution.
- **Native prepare** is diagnostic only because the APIs do different work.

Every runner must first produce deeply equal values in the same order for
shallow, deep, filtered, descendant, and compound-filter queries.
Samples use adaptive batches, rotate engine order, and report median throughput
plus the full sample range.

JSONPath Plus uses its safe evaluator and populated path cache in the hot
benchmark. jsonpath-rfc9535 does not expose a reusable query runner, so its hot
measurement still parses each call. The jsonjoy interpreter reuses a parsed
path. Its JIT mode compiles a specialized runner.

`1.50x padvinder` means the engine completed 1.5 times as many operations per
second as padvinder in that workload. Ratios can exaggerate tiny absolute
differences, and results vary with Node version, hardware, power state, and
background activity. Compare repeated runs on the same machine.

The suite runs under normal Node because the jsonjoy JIT mode generates a
specialized runner. The existing `npm run bench` remains the zero-dependency
regression benchmark under the repository's strict-CSP simulation.

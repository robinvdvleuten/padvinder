import { readFileSync } from 'node:fs';
import test from 'tape';
import { query } from '../src/index.js';

// The official JSONPath Compliance Test Suite, vendored from
// https://github.com/jsonpath-standard/jsonpath-compliance-test-suite
// under the BSD-2 license retained in ./cts.LICENSE. Refresh both with
// `npm run cts:update`.
const cts = JSON.parse(readFileSync(new URL('./cts.json', import.meta.url)));

// Documented divergences from RFC 9535. Empty since the RFC filter grammar
// landed; the structure stays so future CTS updates that surface a new
// dialect boundary get recorded here, with a reason, instead of skipped.
// Every entry must keep failing — when a fix makes one conformant, the
// ledger check flags it so the entry gets removed.
const DIALECT = new Map();

test('compliance: valid selectors', t => {
	const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
	let pass = 0, dialect = 0;
	for (const c of cts.tests) {
		if (c.invalid_selector) continue;
		let out, threw = false;
		try { out = query(c.selector)(c.document); } catch { threw = true; }
		const good = !threw && (c.results ? c.results.some(r => eq(out, r)) : eq(out, c.result));
		if (DIALECT.has(c.name)) {
			dialect++;
			good && t.fail('now conformant, remove from ledger: ' + c.name);
		} else if (good) {
			pass++;
		} else {
			t.fail(c.name + ' | ' + c.selector);
		}
	}
	t.equal(pass + dialect, cts.tests.filter(c => !c.invalid_selector).length, 'every valid case accounted for');
	t.pass(pass + ' conformant, ' + dialect + ' documented divergences');
	t.end();
});

test('compliance: invalid selectors', t => {
	let rejected = 0, total = 0;
	for (const c of cts.tests) {
		if (!c.invalid_selector) continue;
		total++;
		try { query(c.selector); } catch { rejected++; }
	}
	// padvinder is deliberately more lenient than the RFC grammar (it accepts
	// a superset); pin the floor so strictness never silently regresses.
	t.ok(rejected >= 174, 'rejects ' + rejected + '/' + total + ' RFC-invalid selectors');
	t.end();
});

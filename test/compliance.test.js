import { readFileSync } from 'node:fs';
import test from 'tape';
import { query } from '../src/index.js';

// The official JSONPath Compliance Test Suite, vendored from
// https://github.com/jsonpath-standard/jsonpath-compliance-test-suite
// under the BSD-2 license retained in ./cts.LICENSE. Refresh both with
// `npm run cts:update`.
const cts = JSON.parse(readFileSync(new URL('./cts.json', import.meta.url)));

// Documented divergences from RFC 9535. padvinder filters are xprsn
// expressions, not the RFC filter grammar; these cases differ by design.
// Every entry must keep failing — when a fix makes one conformant, the
// ledger check flags it so the entry gets removed.
const DIALECT = new Map();
const diverge = (reason, names) => names.forEach(n => DIALECT.set(n, reason));

diverge('filters are truthiness tests, so a present-but-falsy value does not match', [
	'filter, existence, without segments',
	'filter, existence, present with null',
	'filter, exists and exists, data false',
	'filter, exists or exists, data false',
	'filter, not exists, data null',
]);

diverge('== is strict equality, not the RFC deep equality', [
	'filter, deep equality, arrays',
	'filter, deep equality, objects',
]);

diverge('JSONPath subqueries inside filters (@.*, @[...], count(), value()) are not xprsn expressions', [
	'filter, non-singular existence, wildcard',
	'filter, non-singular existence, multiple',
	'filter, non-singular existence, slice',
	'filter, non-singular existence, negated',
	'filter, nested',
	'filter, equals, special nothing',
	'functions, count, count function',
	'functions, count, single-node arg',
	'functions, count, multiple-selector arg',
	'functions, length, arg is a function expression',
	'functions, length, arg is special nothing',
	'functions, match, arg is a function expression',
	'functions, search, arg is a function expression',
	'functions, value, single-value nodelist',
	'functions, value, multi-value nodelist',
	'whitespace, functions, space between parenthesis and arg',
	'whitespace, functions, newline between parenthesis and arg',
	'whitespace, functions, tab between parenthesis and arg',
	'whitespace, functions, return between parenthesis and arg',
	'whitespace, functions, space between arg and parenthesis',
	'whitespace, functions, newline between arg and parenthesis',
	'whitespace, functions, tab between arg and parenthesis',
	'whitespace, functions, return between arg and parenthesis',
]);

diverge('access below a missing property throws; the xprsn dialect spells this ?.', [
	'filter, absolute existence, with segments',
	'whitespace, functions, spaces in a relative singular selector',
	'whitespace, functions, newlines in a relative singular selector',
	'whitespace, functions, tabs in a relative singular selector',
	'whitespace, functions, returns in a relative singular selector',
]);

diverge('bracket keys use JS indexing: arrays accept "0", objects accept 0', [
	'filter, name segment on array, selects nothing',
	'filter, index segment on object, selects nothing',
]);

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
	t.ok(rejected >= 178, 'rejects ' + rejected + '/' + total + ' RFC-invalid selectors');
	t.end();
});

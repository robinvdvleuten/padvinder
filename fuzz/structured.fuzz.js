import assert from 'node:assert';
import { FuzzedDataProvider } from '@jazzer.js/core';
import { query } from '../src/index.js';
import { FIXTURE, collect, snap } from './lib.js';

const { nodes, leaves } = collect(FIXTURE);
const before = snap(FIXTURE);

// TOTAL, stateless, deterministic, non-mutating custom function extensions, so
// any exception reaching the oracle comes from padvinder, not the harness.
const num = x => { try { return Number(x); } catch { return 0; } };
const FUNCS = {
	dbl: x => num(x) * 2,
	yes: () => true,
	str: x => (x == null ? '' : String(x)),
};

// Names the generator uses; blocked keys are woven in to drive the guard.
const KEYS = ['store', 'book', 'bicycle', 'price', 'title', 'category', 'tags', 'meta', 'count', 'nums', 'deep', 'a', 'b', 'c'];
const BLOCKED = ['__proto__', 'constructor', 'prototype'];

const pick = (data, arr) => arr[data.consumeIntegralInRange(0, arr.length - 1)];
const name = data => data.consumeIntegralInRange(0, 6) === 0 ? pick(data, BLOCKED) : pick(data, KEYS);

const RE_ATOM = ['a', 'b', '.', '[a-z]', '[^b]', '\\p{L}', '\\P{N}'];
function regex(data, depth) {
	const a = pick(data, RE_ATOM);
	if (!depth || data.remainingBytes < 2) return a;
	const k = data.consumeIntegralInRange(0, 5);
	if (k === 0) return regex(data, depth - 1) + regex(data, depth - 1);
	if (k === 1) return `(${regex(data, depth - 1)}|${regex(data, depth - 1)})`;
	if (k === 2) return `(${regex(data, depth - 1)})${pick(data, ['*', '+', '?'])}`;
	if (k === 3) return `${a}{${data.consumeIntegralInRange(0, 3)},${data.consumeIntegralInRange(3, 5)}}`;
	if (k === 4) return '^' + regex(data, depth - 1);
	return regex(data, depth - 1) + '$';
}
function nativeRegex(p, full) {
	let out = '', cls = false;
	for (let i = 0; i < p.length; i++) {
		const c = p[i];
		if (c === '\\') { out += c + p[++i]; continue; }
		if (c === '[') cls = true;
		else if (c === ']') cls = false;
		out += c === '.' && !cls ? '[^\\n\\r]' : c;
	}
	return new RegExp(full ? '^(?:' + out + ')$' : out, 'u');
}

// A ValueType operand for filters: a singular query, or a literal.
function operand(data, depth) {
	const k = data.consumeIntegralInRange(0, 4);
	if (k === 0) return String(data.consumeIntegralInRange(-5, 20));
	if (k === 1) return JSON.stringify('t-a');
	if (k === 2) return data.consumeBoolean() ? 'true' : 'false';
	if (k === 3) return `@.${name(data)}`;
	return `$.${name(data)}`;
}

function filter(data, depth) {
	if (depth <= 0 || data.remainingBytes < 2) return `@.${name(data)}`;
	const k = data.consumeIntegralInRange(0, 6);
	if (k === 0) return `@.${name(data)}`; // existence
	if (k === 1) {
		const op = pick(data, ['==', '!=', '<', '>', '<=', '>=']);
		return `${operand(data, depth - 1)} ${op} ${operand(data, depth - 1)}`;
	}
	if (k === 2) return `(${filter(data, depth - 1)} && ${filter(data, depth - 1)})`;
	if (k === 3) return `(${filter(data, depth - 1)} || ${filter(data, depth - 1)})`;
	if (k === 4) return `!(${filter(data, depth - 1)})`;
	if (k === 5) {
		const fn = pick(data, ['match', 'search']);
		return `${fn}(@.${name(data)}, ${JSON.stringify(regex(data, depth - 1))})`;
	}
	// length/count/value comparison
	const fn = pick(data, ['length', 'count', 'value']);
	return `${fn}(@.${name(data)}) ${pick(data, ['==', '<', '>'])} ${data.consumeIntegralInRange(0, 5)}`;
}

function selector(data, depth) {
	const k = data.consumeIntegralInRange(0, 6);
	if (k === 0) return '*';
	if (k === 1) return String(data.consumeIntegralInRange(-3, 4)); // index
	if (k === 2) return JSON.stringify(name(data)); // quoted name
	if (k === 3) { // slice
		const s = data.consumeIntegralInRange(-2, 4), e = data.consumeIntegralInRange(-2, 5), st = data.consumeIntegralInRange(1, 2);
		return `${s}:${e}:${st}`;
	}
	if (k === 4) return `${JSON.stringify(name(data))},${data.consumeIntegralInRange(0, 3)}`; // union
	return `?${filter(data, depth)}`; // filter
}

// A grammatically VALID path. Any compile error on this is a finding.
function buildValid(data) {
	const depth = data.consumeIntegralInRange(1, 4);
	let path = '$';
	const segs = data.consumeIntegralInRange(1, 5);
	for (let i = 0; i < segs; i++) {
		const k = data.consumeIntegralInRange(0, 3);
		if (k === 0) path += `.${name(data)}`;
		else if (k === 1) path += `..${name(data)}`;
		else if (k === 2) path += `[${selector(data, depth)}]`;
		else path += data.consumeBoolean() ? '.*' : '..*';
	}
	return path;
}

// A deliberately MALFORMED path: only SyntaxError is acceptable for these.
function buildMalformed(data) {
	const base = buildValid(data);
	const k = data.consumeIntegralInRange(0, 5);
	if (k === 0) return base.slice(1); // drop leading $
	if (k === 1) return base + '['; // unclosed bracket
	if (k === 2) return base + '[?(@.a'; // unclosed filter
	if (k === 3) return base + '.'; // trailing dot
	if (k === 4) return base + '[!!]'; // bad selector
	return base + ' &&'; // dangling operator
}

const isCompileErr = e => e instanceof SyntaxError;

// A returned node must be a genuine location in FIXTURE.
function assertReachable(out) {
	for (const r of out) {
		if (r !== null && typeof r === 'object') {
			if (!nodes.has(r)) throw new Error('result object is not a node of the data');
		} else if (!leaves.has(r)) {
			throw new Error('result primitive is not a leaf of the data');
		}
	}
}

// Element-wise identity (objects) / Object.is (primitives): two distinct nodes
// that happen to be deep-equal must not be mistaken for a determinism pass.
function sameResult(a, b) {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) {
		const x = a[i], y = b[i];
		if (x !== null && typeof x === 'object') { if (x !== y) return false; }
		else if (!Object.is(x, y)) return false;
	}
	return true;
}

// ---- fixed batteries (data-independent invariants), asserted once at load ----

// Blocked and inherited keys never appear in results, for objects AND arrays.
(function battery() {
	// Objects: blocked keys are inert everywhere (search, not access).
	for (const p of ['$.constructor', "$['__proto__']", '$..prototype', '$.a.constructor', '$[?@.constructor]', '$.list[?@["__proto__"]]']) {
		assert.deepStrictEqual(query(p)({ a: {}, list: [{}] }), [], 'blocked key matched: ' + p);
	}
	// Inherited object property never matches (own-only).
	const proto = { inherited: 'nope-o' };
	const obj = Object.assign(Object.create(proto), { own: 'yes-o' });
	assert.deepStrictEqual(query('$.x.inherited')({ x: obj }), [], 'inherited object prop matched');
	assert.deepStrictEqual(query('$.x.own')({ x: obj }), ['yes-o']);

	// Inherited ARRAY index never matches. A REAL array (Array.isArray stays
	// true) with a hole at index 0 whose value resolves through a LOCAL custom
	// prototype (no global Array.prototype touch).
	const arrProto = Object.create(Array.prototype);
	arrProto[0] = 'nope-a';
	const arr = []; arr.length = 2; arr[1] = 'own-a'; Object.setPrototypeOf(arr, arrProto);
	for (const p of ['$.arr[0]', '$.arr[*]', '$.arr..*', '$.arr[0:2]', '$.arr[?@ == "nope-a"]']) {
		if (query(p)({ arr }).includes('nope-a')) throw new Error('inherited array index leaked via ' + p);
	}
	if (!query('$.arr[1]')({ arr }).includes('own-a')) throw new Error('own array index lost');
})();

// match/search correctness: anchoring, dot/newline semantics, invalid patterns.
(function regexBattery() {
	const eq = (p, data, exp, m) => assert.deepStrictEqual(query(p)(data), exp, m);
	eq('$.s[?match(@, "a.c")]', { s: ['abc'] }, ['abc'], 'match is full, dot matches');
	eq('$.s[?match(@, "b")]', { s: ['abc'] }, [], 'match must be anchored (full)');
	eq('$.s[?search(@, "b")]', { s: ['abc'] }, ['abc'], 'search is substring');
	eq('$.s[?match(@, ".")]', { s: ['a\nb'] }, [], 'I-Regexp dot excludes newline; full-match fails');
	eq('$.s[?search(@, "(")]', { s: ['a'] }, [], 'invalid pattern -> no match, no throw');
	eq('$.s[?match(@, "a")]', { s: [123] }, [], 'non-string subject -> no match');
	eq('$[?search(@, "(a+)+$")]', ['a'.repeat(1000) + '!'], [], 'nested repetition stays bounded');
})();

(function stringBattery() {
	assert.deepStrictEqual(query(String.raw`$['say "hi"']`)({ 'say "hi"': 1 }), [1]);
	assert.deepStrictEqual(query(String.raw`$['\uD83D\uDE00']`)({ '😀': 1 }), [1]);
	for (const path of [
		String.raw`$['a\"b']`,
		String.raw`$["a\'b"]`,
		String.raw`$['\uD800']`,
		String.raw`$["\uDC00"]`,
		"$['\ud83d" + String.raw`\uDE00']`,
		String.raw`$['\uD83D` + "\ude00']",
		String.raw`$['\u12']`,
	]) assert.throws(() => query(path), SyntaxError);
})();

// Cyclic recursive descent terminates (bounded; no unions over the cycle).
(function cycleBattery() {
	const node = { name: 'cyc' }; node.self = node;
	assert.deepStrictEqual(query('$..name')({ node }), ['cyc'], 'cycle visited once');
	const shared = { v: 7 };
	assert.deepStrictEqual(query('$..v')({ p: shared, q: shared }), [7, 7], 'diamond still matches per location');
})();

const OP = Object.prototype;
const PROTO_KEYS = Object.getOwnPropertyNames(OP).length;
const PROTO_HAS_OWN = OP.hasOwnProperty;
const PROTO_TO_STRING = OP.toString;
const protoIntact = () =>
	Object.getOwnPropertyNames(OP).length === PROTO_KEYS &&
	OP.hasOwnProperty === PROTO_HAS_OWN &&
	OP.toString === PROTO_TO_STRING;

export function fuzz(data) {
	const provider = new FuzzedDataProvider(data);
	const malformed = provider.consumeIntegralInRange(0, 3) === 0;
	const path = malformed ? buildMalformed(provider) : buildValid(provider);

	let run;
	try {
		run = query(path, FUNCS);
	} catch (e) {
		if (!isCompileErr(e)) throw e;
		// VALID paths must compile; only MALFORMED ones may throw SyntaxError.
		if (!malformed) throw new Error('valid generated path rejected: ' + path + ' :: ' + e.message);
		return;
	}

	let out;
	try {
		out = run(FIXTURE);
	} finally {
		if (!protoIntact()) throw new Error('Object.prototype polluted');
		if (snap(FIXTURE) !== before) throw new Error('query mutated the data');
	}
	if (!Array.isArray(out)) throw new Error('query did not return an array');

	assertReachable(out);
	const second = run(FIXTURE);
	assert.ok(sameResult(out, second), 'non-deterministic query: ' + path);

	// Differential oracle over short subjects: native backtracking is safe at
	// these bounds and checks the NFA's Boolean semantics independently.
	const pattern = regex(provider, 3);
	const texts = ['', 'a', 'ab', 'bbb', 'Ä', '1', 'a\nb'];
	for (const fn of ['match', 'search']) {
		const full = fn === 'match', expected = texts.filter(x => nativeRegex(pattern, full).test(x));
		const actual = query(`$[?${fn}(@, ${JSON.stringify(pattern)})]`)(texts);
		assert.deepStrictEqual(actual, expected, fn + ' mismatch for ' + pattern);
	}
}

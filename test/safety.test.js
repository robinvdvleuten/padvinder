import { readFileSync } from 'node:fs';
import test from 'tape';
import { find } from '../src/index.js';

test('blocked keys never match', t => {
	t.deepEqual(find('$.constructor', {}), []);
	t.deepEqual(find('$.a.__proto__', { a: {} }), []);
	t.deepEqual(find("$['__proto__']", {}), []);
	t.deepEqual(find('$..constructor', { a: { b: 1 } }), []);
	t.deepEqual(find('$.*', { __proto__: null, a: 1, constructor: 2 }), [1], 'wildcard skips blocked own keys');
	t.end();
});

test('blocked keys inside RFC-shaped filters match nothing', t => {
	t.deepEqual(find('$.list[?(@.constructor)]', { list: [{}] }), [], 'existence test, no throw');
	t.deepEqual(find('$.list[?(@["__proto__"])]', { list: [{}] }), []);
	t.end();
});

test('xprsn guards apply inside fallback filters', t => {
	// String concatenation is not RFC grammar, so these route to xprsn,
	// where blocked keys throw.
	t.throws(() => find('$.list[?(@["cons" + "tructor"])]', { list: [{}] }), TypeError);
	t.throws(() => find('$.list[?(@["__pro" + "to__"])]', { list: [{}] }), TypeError);
	t.end();
});

test('inherited properties never match', t => {
	const proto = { inherited: 'nope' };
	const obj = Object.assign(Object.create(proto), { own: 'yes' });
	t.deepEqual(find('$.a.inherited', { a: obj }), []);
	t.deepEqual(find('$.a.own', { a: obj }), ['yes']);
	t.end();
});

test('recursive descent survives cyclic data', t => {
	const node = { name: 'x' };
	node.self = node;
	t.deepEqual(find('$..name', { node }), ['x'], 'cycle visited once, no hang');

	const shared = { v: 1 };
	t.deepEqual(find('$..v', { p: shared, q: shared }), [1, 1], 'diamond refs still match per location');
	t.end();
});

test('queries never modify the data', t => {
	const data = { store: { book: [{ price: 5 }] } };
	const snapshot = JSON.stringify(data);
	find('$..book[?(@.price > 1)].price', data);
	t.equal(JSON.stringify(data), snapshot);
	t.end();
});

test('source contains no string-to-code constructs', t => {
	const src = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
	t.notOk(/\beval\b|\bFunction\s*\(|new\s+Function/.test(src));
	t.end();
});

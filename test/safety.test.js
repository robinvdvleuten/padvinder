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

test('blocked keys inside filters match nothing', t => {
	t.deepEqual(find('$.list[?@.constructor]', { list: [{}] }), [], 'existence test, no match');
	t.deepEqual(find('$.list[?@["__proto__"]]', { list: [{}] }), []);
	t.deepEqual(find('$.list[?@.constructor == 1]', { list: [{}] }), [], 'comparison never reaches the prototype');
	t.end();
});

test('inherited properties never match', t => {
	const proto = { inherited: 'nope' };
	const obj = Object.assign(Object.create(proto), { own: 'yes' });
	t.deepEqual(find('$.a.inherited', { a: obj }), []);
	t.deepEqual(find('$.a.own', { a: obj }), ['yes']);
	t.end();
});

test('inherited array indexes never match', t => {
	// A real array (Array.isArray stays true) with a hole at index 0 whose value
	// would resolve through a custom prototype — the index, wildcard, descendant,
	// and slice paths must all read own elements only.
	const proto = Object.create(Array.prototype);
	proto[0] = 'inherited';
	const arr = [];
	arr.length = 2;
	arr[1] = 'own';
	Object.setPrototypeOf(arr, proto);
	t.deepEqual(find('$.arr[0]', { arr }), [], 'index selector skips the hole');
	t.deepEqual(find('$.arr[*]', { arr }), ['own'], 'wildcard skips the hole');
	t.deepEqual(find('$.arr..*', { arr }), ['own'], 'descendant skips the hole');
	t.deepEqual(find('$.arr[0:2]', { arr }), ['own'], 'slice skips the hole');
	t.deepEqual(find('$.arr[1]', { arr }), ['own'], 'own index still matches');
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

test('I-Regexp matching has bounded worst-case work', t => {
	const n = 30_000;
	const text = 'a'.repeat(n) + '!';
	const t0 = Date.now();

	t.deepEqual(find('$[?search(@, "(a+)+$")]', [text]), [], 'nested repetition');
	t.deepEqual(find('$[?match(@, "(a*)*")]', ['a'.repeat(n)]), ['a'.repeat(n)], 'nullable cycle');
	t.deepEqual(find('$[?search(@, "(a|aa)+$")]', [text]), [], 'ambiguous alternation');
	t.deepEqual(find('$[?match(@, "a{1000000}")]', ['a']), [], 'huge range rejected');
	t.deepEqual(find('$[?search(@, ' + JSON.stringify('[' + 'b'.repeat(4093) + ']') + ')]', [text]), [], 'class work cap');
	t.deepEqual(find('$[?match(@, "a{1024}a{1024}a{1024}a{1024}")]', Array(5000).fill('a')), [], 'invalid pattern cache');
	t.deepEqual(find('$[?search(@, "")]', ['a'.repeat(1_000_001)]), [], 'subject scalar cap');
	t.deepEqual(find('$.values[?match(@, $.regex)]', {
		regex: 'a'.repeat(1_000_000),
		values: Array(5000).fill('a'),
	}), [], 'oversized dynamic pattern is not retained');

	t.ok(Date.now() - t0 < 1500, 'completes within the work budget');
	t.end();
});

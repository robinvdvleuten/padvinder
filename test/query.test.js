import test from 'tape';
import { query, find } from '../src/index.js';

const data = {
	store: {
		book: [
			{ category: 'reference', author: 'Nigel Rees', title: 'Sayings of the Century', price: 8.95 },
			{ category: 'fiction', author: 'Evelyn Waugh', title: 'Sword of Honour', price: 12.99 },
			{ category: 'fiction', author: 'Herman Melville', title: 'Moby Dick', price: 8.99 },
			{ category: 'fiction', author: 'J. R. R. Tolkien', title: 'The Lord of the Rings', price: 22.99 },
		],
		bicycle: { color: 'red', price: 19.95 },
	},
};

test('child access', t => {
	t.deepEqual(find('$.store.bicycle.color', data), ['red']);
	t.deepEqual(find('$.store.book[0].title', data), ['Sayings of the Century']);
	t.deepEqual(find('$.store.book[-1].title', data), ['The Lord of the Rings']);
	t.deepEqual(find("$.store['bicycle']['color']", data), ['red']);
	t.deepEqual(find('$["store"]["bicycle"]', data), [{ color: 'red', price: 19.95 }]);
	t.deepEqual(find('$.store.book[9].title', data), [], 'out of bounds matches nothing');
	t.deepEqual(find('$.nope.deeper', data), [], 'missing paths match nothing');
	t.end();
});

test('wildcards', t => {
	t.deepEqual(find('$.store.book[*].author', data), ['Nigel Rees', 'Evelyn Waugh', 'Herman Melville', 'J. R. R. Tolkien']);
	t.deepEqual(find('$.store.*.price', data).sort(), [19.95], 'dot wildcard over object values');
	t.deepEqual(find('$.store.bicycle.*', data), ['red', 19.95]);
	t.end();
});

test('recursive descent', t => {
	t.deepEqual(find('$..author', data), ['Nigel Rees', 'Evelyn Waugh', 'Herman Melville', 'J. R. R. Tolkien']);
	t.deepEqual(find('$..price', data), [8.95, 12.99, 8.99, 22.99, 19.95]);
	t.deepEqual(find('$..book[0].title', data), ['Sayings of the Century']);
	t.end();
});

test('slices', t => {
	const titles = b => b.map(x => x.title);
	t.deepEqual(titles(find('$.store.book[1:3]', data)), ['Sword of Honour', 'Moby Dick']);
	t.deepEqual(titles(find('$.store.book[:2]', data)), ['Sayings of the Century', 'Sword of Honour']);
	t.deepEqual(titles(find('$.store.book[-2:]', data)), ['Moby Dick', 'The Lord of the Rings']);
	t.deepEqual(titles(find('$.store.book[0:4:2]', data)), ['Sayings of the Century', 'Moby Dick'], 'step');
	t.end();
});

test('quoted keys unescape', t => {
	t.deepEqual(find("$['it\\'s']", { "it's": 1 }), [1], 'escaped single quote');
	t.deepEqual(find('$["say \\"hi\\""]', { 'say "hi"': 2 }), [2], 'escaped double quotes');
	t.deepEqual(find("$['back\\\\slash']", { 'back\\slash': 3 }), [3], 'escaped backslash');
	t.deepEqual(find("$['a,b']", { 'a,b': 4 }), [4], 'comma inside quotes is not a union');
	t.deepEqual(find("$['spaced key'].x", { 'spaced key': { x: 5 } }), [5]);
	t.end();
});

test('unions', t => {
	t.deepEqual(find('$.store.book[0,2].title', data), ['Sayings of the Century', 'Moby Dick']);
	t.deepEqual(find("$.store.bicycle['color','price']", data), ['red', 19.95]);
	t.end();
});

test('filters are xprsn expressions', t => {
	t.deepEqual(find('$.store.book[?(@.price < 10)].title', data), ['Sayings of the Century', 'Moby Dick']);
	t.deepEqual(find('$..book[?(@.category == "fiction" and @.price < 20)].title', data), ['Sword of Honour', 'Moby Dick']);
	t.deepEqual(find("$.store.book[?(@.title.startsWith('S'))].title", data), ['Sayings of the Century', 'Sword of Honour']);
	t.deepEqual(find('$.store.book[?(@.category in ["reference"])].title', data), ['Sayings of the Century']);
	t.deepEqual(find('$.store.book[?(@.missing?.deep)].title', data), [], 'null-safe access in filters');
	t.deepEqual(find('$.store.book[?((@.price ?? 99) < 9)].title', data), ['Sayings of the Century', 'Moby Dick']);
	t.end();
});

test('RFC filter semantics', t => {
	t.deepEqual(find('$.list[?@.a]', { list: [{ a: null }, { a: false }, {}] }), [{ a: null }, { a: false }],
		'existence matches present-but-falsy values');
	t.deepEqual(find('$.list[?@.a == @.b].n', { list: [{ n: 1, a: [1, [2]], b: [1, [2]] }, { n: 2, a: [1], b: [2] }] }), [1],
		'== is deep equality');
	t.deepEqual(find('$.list[?@.missing == @.gone].n', { list: [{ n: 1 }] }), [1],
		'Nothing equals Nothing');
	t.deepEqual(find('$.list[?@.a.b == 1].n', { list: [{ n: 1, a: { b: 1 } }, { n: 2 }] }), [1],
		'missing paths compare as Nothing instead of throwing');
	t.deepEqual(find('$.list[?count(@.*) > 2].n', { list: [{ n: 1, a: 1, b: 2, c: 3 }, { n: 2 }] }), [1],
		'count() over a subquery nodelist');
	t.deepEqual(find('$[?@[?@ > 1]]', [[1], [1, 2], [0]]), [[1, 2]], 'nested filters');
	t.deepEqual(find('$.list[?length(@.name) == 5].name', { list: [{ name: 'Robin' }, { name: 'Bo' }] }), ['Robin']);
	t.deepEqual(find('$.list[?match(@.sku, "X-[0-9]+")].sku', { list: [{ sku: 'X-42' }, { sku: 'Y-1' }] }), ['X-42']);
	t.end();
});

test('both filter grammars coexist in one path', t => {
	const data = { groups: [{ size: 2, items: ['Sword', 'Moby'] }, { size: 1, items: ['Saying'] }] };
	t.deepEqual(
		find('$.groups[?@.size > 1].items[?(@.startsWith("S"))]', data),
		['Sword'],
		'an RFC filter feeding an xprsn method-call filter'
	);
	t.end();
});

test('filters can reference the root as $', t => {
	t.deepEqual(
		find('$.store.book[?(@.price > $.store.bicycle.price)].title', data),
		['The Lord of the Rings']
	);
	t.end();
});

test('@ inside filter strings survives', t => {
	const users = { list: [{ email: 'a@b.c' }, { email: 'x@y.z' }] };
	t.deepEqual(find('$.list[?(@.email == "a@b.c")].email', users), ['a@b.c']);
	t.end();
});

test('custom functions in filters', t => {
	t.deepEqual(
		find('$.store.book[?(cheap(@))].title', data, { cheap: b => b.price < 9 }),
		['Sayings of the Century', 'Moby Dick']
	);
	t.end();
});

test('compile once, run many', t => {
	const q = query('$..book[?(@.price < 10)].title');
	t.deepEqual(q(data), ['Sayings of the Century', 'Moby Dick']);
	t.deepEqual(q({ store: { book: [{ title: 'x', price: 1 }] } }), ['x']);
	t.deepEqual(q({}), []);
	t.end();
});

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

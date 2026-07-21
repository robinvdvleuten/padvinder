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
	t.deepEqual(find(String.raw`$['say "hi"']`, { 'say "hi"': 4 }), [4], 'raw opposite quote');
	t.deepEqual(find(String.raw`$['\uD83D\uDE00']`, { '😀': 5 }), [5], 'escaped surrogate pair');
	t.deepEqual(find("$['😀']", { '😀': 6 }), [6], 'raw supplementary scalar');
	t.deepEqual(find("$['a,b']", { 'a,b': 4 }), [4], 'comma inside quotes is not a union');
	t.deepEqual(find("$['spaced key'].x", { 'spaced key': { x: 5 } }), [5]);
	t.end();
});

test('unions', t => {
	t.deepEqual(find('$.store.book[0,2].title', data), ['Sayings of the Century', 'Moby Dick']);
	t.deepEqual(find("$.store.bicycle['color','price']", data), ['red', 19.95]);
	t.end();
});

test('filters', t => {
	t.deepEqual(find('$.store.book[?@.price < 10].title', data), ['Sayings of the Century', 'Moby Dick']);
	t.deepEqual(find('$.store.book[?(@.price < 10)].title', data), ['Sayings of the Century', 'Moby Dick'], 'parens optional');
	t.deepEqual(find('$..book[?@.category == "fiction" && @.price < 20].title', data), ['Sword of Honour', 'Moby Dick']);
	t.deepEqual(find('$..book[?@.category == "reference" || @.price > 20].title', data), ['Sayings of the Century', 'The Lord of the Rings']);
	t.deepEqual(find('$.store.book[?!(@.price < 10)].title', data), ['Sword of Honour', 'The Lord of the Rings'], 'negation');
	t.deepEqual(find("$.store.book[?search(@.title, '^S')].title", data), ['Sayings of the Century', 'Sword of Honour']);
	t.deepEqual(find('$.store.book[?@.missing.deep].title', data), [], 'missing path is absent, not an error');
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

test('I-Regexp grammar and Unicode semantics', t => {
	const match = (p, values) => find('$[?match(@, ' + JSON.stringify(p) + ')]', values);
	const search = (p, values) => find('$[?search(@, ' + JSON.stringify(p) + ')]', values);

	t.deepEqual(match('(ab|cd)+', ['ab', 'abcd', 'cdab', 'a']), ['ab', 'abcd', 'cdab'], 'groups and alternation');
	t.deepEqual(match('a{2,4}', ['a', 'aa', 'aaaa', 'aaaaa']), ['aa', 'aaaa'], 'range quantifier');
	t.deepEqual(match('a|', ['', 'a', 'aa']), ['', 'a'], 'empty alternative');
	t.deepEqual(match('', ['', 'a']), [''], 'empty full match');
	t.deepEqual(search('', ['', 'a']), ['', 'a'], 'empty search');
	t.deepEqual(search('^ab', ['abx', 'zab']), ['abx'], '^ anchors the subject');
	t.deepEqual(search('ab$', ['zab', 'abz']), ['zab'], '$ anchors the subject');
	t.deepEqual(match('[-a]+', ['a-a', 'bbb']), ['a-a'], 'leading hyphen in class');
	t.deepEqual(match('[^a]+', ['bbb', 'aba']), ['bbb'], 'negated class');
	t.deepEqual(match('[\\[]+', ['[[', ']']), ['[['], 'escaped opening bracket');
	t.deepEqual(match('[\\]]+', [']]', '[']), [']]'], 'escaped closing bracket');
	t.deepEqual(match('[\\\\]+', ['\\', '/']), ['\\'], 'escaped backslash');
	t.deepEqual(match('[\\n-\\r]+', ['\n\f\r', '\t']), ['\n\f\r'], 'escaped range endpoints');
	t.deepEqual(match('\\p{Lu}+', ['ABC', 'Abc', 'Ä']), ['ABC', 'Ä'], 'Unicode property');
	t.deepEqual(match('\\P{Lu}+', ['abc', 'ABC']), ['abc'], 'Unicode property complement');
	t.deepEqual(match('.', ['x', '\u2028', '\n', '😀']), ['x', '\u2028', '😀'], 'dot uses Unicode scalars and excludes newline');
	t.end();
});

test('invalid or over-budget I-Regexp patterns match nothing', t => {
	const run = p => find('$[?match(@, ' + JSON.stringify(p) + ')]', ['a', 'aaa']);
	for (const p of ['\\d+', '(?=a)', '(a)\\1', 'a+?', '[^]', '[[]', '[a[b]', '[z-a]', 'a{1025}', '('.repeat(65) + 'a' + ')'.repeat(65)]) {
		t.deepEqual(run(p), [], p);
	}
	t.throws(() => run('\ud800'), SyntaxError, 'lone surrogate is not a valid filter string');
	t.deepEqual(run('a'.repeat(4097)), [], 'pattern length cap');
	t.deepEqual(run('a{0001024}'), [], 'quantifier digit cap');
	t.deepEqual(run('('.repeat(64) + 'a' + ')'.repeat(64)), ['a'], 'deepest group nesting compiles');
	t.deepEqual(find('$[?match(@, "a{1024}")]', ['a'.repeat(1024)]), ['a'.repeat(1024)], 'largest range compiles');
	t.deepEqual(find('$[?match(@, ' + JSON.stringify('a'.repeat(4094)) + ')]', ['a'.repeat(4094)]), ['a'.repeat(4094)], 'largest NFA compiles');
	t.deepEqual(find('$[?match(@, ' + JSON.stringify('[' + 'a'.repeat(4094) + ']') + ')]', ['a']), ['a'], 'largest pattern compiles');
	t.end();
});

test('chained filters across segments', t => {
	const data = { groups: [{ size: 2, items: [{ n: 'Sword', p: 5 }, { n: 'Moby', p: 50 }] }, { size: 1, items: [{ n: 'Saying', p: 1 }] }] };
	t.deepEqual(
		find('$.groups[?@.size > 1].items[?@.p < 10].n', data),
		['Sword'],
		'one filter feeds the next'
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

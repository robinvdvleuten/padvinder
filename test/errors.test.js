import test from 'tape';
import { query } from '../src/index.js';

test('malformed paths', t => {
	t.throws(() => query('store.book'), /Path must start with \$/);
	t.throws(() => query(''), /Path must start with \$/);
	t.throws(() => query('$.store['), /Missing \]/);
	t.throws(() => query('$.store[?(@.a'), /Missing \]/);
	t.throws(() => query('$.store.'), SyntaxError);
	t.throws(() => query('$store'), SyntaxError, 'name straight after $ needs a dot');
	t.throws(() => query('$.store[!!]'), /Bad selector/);
	t.end();
});

test('invalid quoted-string escapes fail at compile time', t => {
	t.throws(() => query(String.raw`$['a\"b']`), SyntaxError, 'double-quote escape in single quotes');
	t.throws(() => query(String.raw`$["a\'b"]`), SyntaxError, 'single-quote escape in double quotes');
	t.throws(() => query(String.raw`$['\uD800']`), SyntaxError, 'lone high surrogate');
	t.throws(() => query(String.raw`$["\uDC00"]`), SyntaxError, 'lone low surrogate');
	t.throws(() => query("$['\ud83d" + String.raw`\uDE00']`), SyntaxError, 'raw high plus escaped low surrogate');
	t.throws(() => query(String.raw`$['\uD83D` + "\ude00']"), SyntaxError, 'escaped high plus raw low surrogate');
	t.throws(() => query(String.raw`$['\u12']`), SyntaxError, 'short Unicode escape');
	t.throws(() => query("$['line\nbreak']"), SyntaxError, 'raw control character');
	t.throws(() => query(String.raw`$[?@ == 'a\"b']`), SyntaxError, 'filter string uses the same decoder');
	t.end();
});

test('bad filter expressions fail at compile time', t => {
	t.throws(() => query('$.a[?(@.x >)]'), SyntaxError);
	t.throws(() => query('$.a[?(nope(@))]'), /nope is not a function/);
	t.throws(() => query('$.a[?()]'), SyntaxError);
	t.throws(() => query('$.a[?constructor(@)]'), /constructor is not a function/, 'inherited name is not a built-in function');
	t.end();
});

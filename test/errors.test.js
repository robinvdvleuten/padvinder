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

test('bad filter expressions fail at compile time', t => {
	t.throws(() => query('$.a[?(@.x >)]'), SyntaxError);
	t.throws(() => query('$.a[?(nope(@))]'), /nope is not a function/);
	t.throws(() => query('$.a[?()]'), SyntaxError);
	t.throws(() => query('$.a[?constructor(@)]'), /constructor is not a function/, 'inherited name is not a built-in function');
	t.end();
});

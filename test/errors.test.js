import assert from 'node:assert/strict';
import test from 'node:test';
import { query } from '../src/index.js';

test('malformed paths', () => {
	assert.throws(() => query('store.book'), /Path must start with \$/);
	assert.throws(() => query(''), /Path must start with \$/);
	assert.throws(() => query('$.store['), /Missing \]/);
	assert.throws(() => query('$.store[?(@.a'), /Missing \]/);
	assert.throws(() => query('$.store.'), SyntaxError);
	assert.throws(() => query('$store'), SyntaxError, 'name straight after $ needs a dot');
	assert.throws(() => query('$.store[!!]'), /Bad selector/);
});

test('invalid quoted-string escapes fail at compile time', () => {
	assert.throws(() => query(String.raw`$['a\"b']`), SyntaxError, 'double-quote escape in single quotes');
	assert.throws(() => query(String.raw`$["a\'b"]`), SyntaxError, 'single-quote escape in double quotes');
	assert.throws(() => query(String.raw`$['\uD800']`), SyntaxError, 'lone high surrogate');
	assert.throws(() => query(String.raw`$["\uDC00"]`), SyntaxError, 'lone low surrogate');
	assert.throws(() => query("$['\ud83d" + String.raw`\uDE00']`), SyntaxError, 'raw high plus escaped low surrogate');
	assert.throws(() => query(String.raw`$['\uD83D` + "\ude00']"), SyntaxError, 'escaped high plus raw low surrogate');
	assert.throws(() => query(String.raw`$['\u12']`), SyntaxError, 'short Unicode escape');
	assert.throws(() => query("$['line\nbreak']"), SyntaxError, 'raw control character');
	assert.throws(() => query(String.raw`$[?@ == 'a\"b']`), SyntaxError, 'filter string uses the same decoder');
});

test('bad filter expressions fail at compile time', () => {
	assert.throws(() => query('$.a[?(@.x >)]'), SyntaxError);
	assert.throws(() => query('$.a[?(nope(@))]'), /nope is not a function/);
	assert.throws(() => query('$.a[?()]'), SyntaxError);
	assert.throws(() => query('$.a[?constructor(@)]'), /constructor is not a function/, 'inherited name is not a built-in function');
});

test('invalid traversal options fail at compile time', () => {
	for (const options of [1, [], 'x']) assert.throws(() => query('$', {}, options), TypeError);
	for (const [name, value, type] of [
		['maxNodes', '1', TypeError],
		['maxDepth', -1, RangeError],
		['maxResults', 1.5, RangeError],
		['maxNodes', Infinity, RangeError],
	]) assert.throws(() => query('$', {}, { [name]: value }), type);
	assert.throws(() => query('$', {}, { maxNode: 1 }), /Unknown option/);
	assert.deepStrictEqual(query('$', {}, null)(1), [1]);
});

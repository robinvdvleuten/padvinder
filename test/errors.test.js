import assert from 'node:assert/strict';
import test from 'node:test';
import { isDiagnostic, query } from '../src/index.js';

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

test('padvinder-created errors are authenticated', () => {
	for (const [run, Type] of [
		[() => query('store.book'), SyntaxError],
		[() => query('$', {}, 1), TypeError],
		[() => query('$', {}, { maxDepth: -1 }), RangeError],
	]) assert.throws(run, e =>
		e instanceof Type
		&& isDiagnostic(e)
		&& !Object.hasOwn(e, 'code')
		&& !Object.hasOwn(e, 'limit')
		&& !Object.hasOwn(e, 'actual')
	);
});

test('diagnostic provenance cannot be copied', () => {
	for (const value of [null, undefined, 1, 'PADVINDER_MAX_NODES', {}, SyntaxError('host')])
		assert.strictEqual(isDiagnostic(value), false);

	const spoof = Object.assign(RangeError('spoof'), {
		code: 'PADVINDER_MAX_NODES',
		limit: 1,
		actual: 2,
	});
	assert.strictEqual(isDiagnostic(spoof), false);
});

test('diagnostic provenance is local to a module instance', async () => {
	const other = await import('../src/index.js?instance=provenance');
	let first, second;
	try { query('bad') } catch (e) { first = e }
	try { other.query('bad') } catch (e) { second = e }

	assert.ok(isDiagnostic(first));
	assert.ok(other.isDiagnostic(second));
	assert.strictEqual(isDiagnostic(second), false);
	assert.strictEqual(other.isDiagnostic(first), false);
});

test('captured provenance operations resist prototype replacement', () => {
	const add = WeakSet.prototype.add;
	const has = WeakSet.prototype.has;
	try {
		WeakSet.prototype.add = function () { return this };
		WeakSet.prototype.has = () => true;
		assert.strictEqual(isDiagnostic(Object.assign(SyntaxError('spoof'), { code: 'PADVINDER_MAX_NODES' })), false);
		assert.throws(() => query('bad'), e => e instanceof SyntaxError && isDiagnostic(e));
	} finally {
		WeakSet.prototype.add = add;
		WeakSet.prototype.has = has;
	}
});

test('caller errors pass through unchanged', () => {
	const host = Object.assign(Error('host failed'), { code: 'PADVINDER_MAX_NODES' });
	const path = { toString() { throw host } };
	const data = {};
	Object.defineProperty(data, 'value', { enumerable: true, get() { throw host } });

	for (const run of [
		() => query(path),
		() => query('$.*')(data),
		() => query('$[?fail(@)]', { fail() { throw host } })([1]),
	]) assert.throws(run, e => e === host && !isDiagnostic(e));
});

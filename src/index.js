/**
 * Tiny, CSP-safe JSONPath engine powered by xprsn expressions.
 * Paths and filters compile to a composition of closures; query text is
 * never turned into JavaScript, so strict CSP is satisfied.
 */
import { compile } from 'xprsn';

const BLOCK = k => k === '__proto__' || k === 'constructor' || k === 'prototype';

let err = m => { throw SyntaxError(m) };

// Own child values of a node (guarded).
let kids = n => n && typeof n === 'object'
	? (Array.isArray(n) ? [...n] : Object.keys(n).filter(k => !BLOCK(k)).map(k => n[k]))
	: [];

// Node plus all descendants, depth-first.
let all = n => [n, ...kids(n).flatMap(all)];

let child = (n, k) => {
	if (n == null || typeof n !== 'object' || BLOCK(k)) return [];
	if (Array.isArray(n)) {
		let j = +k;
		if (j < 0) j += n.length;
		return Number.isInteger(j) && j >= 0 && j < n.length ? [n[j]] : [];
	}
	return Object.hasOwn(n, k) ? [n[k]] : [];
};

// Rewrite `@` → `_` and `$` → `_root` outside string literals, so a filter
// becomes a plain xprsn expression with the node and root bound as variables.
let vars = s => {
	let out = '', q = 0;
	for (let j = 0; j < s.length; j++) {
		const c = s[j];
		if (q) { out += c; if (c === '\\') out += s[++j]; else if (c === q) q = 0; }
		else if (c === '"' || c === "'") { q = c; out += c; }
		else out += c === '@' ? '_' : c === '$' ? '_root' : c;
	}
	return out;
};

// Index of the `]` matching the `[` at s[j], respecting nesting and strings.
let close = (s, j) => {
	let d = 0, q = 0;
	for (; j < s.length; j++) {
		const c = s[j];
		if (q) { if (c === '\\') j++; else if (c === q) q = 0; }
		else if (c === '"' || c === "'") q = c;
		else if (c === '[' || c === '(') d++;
		else if (c === ']' || c === ')') { if (!--d) return c === ']' ? j : err('Missing ] in path'); }
	}
	err('Missing ] in path');
};

// Split `[...]` contents on top-level commas (unions).
let split = s => {
	const out = [];
	let d = 0, q = 0, start = 0;
	for (let j = 0; j < s.length; j++) {
		const c = s[j];
		if (q) { if (c === '\\') j++; else if (c === q) q = 0; }
		else if (c === '"' || c === "'") q = c;
		else if (c === '[' || c === '(') d++;
		else if (c === ']' || c === ')') d--;
		else if (c === ',' && !d) { out.push(s.slice(start, j)); start = j + 1; }
	}
	out.push(s.slice(start));
	return out.map(x => x.trim());
};

// One selector inside `[...]` → (nodes, root) => nodes.
let selector = (s, fns) => {
	if (s === '*') return ns => ns.flatMap(kids);
	if (s[0] === '?') {
		const m = /^\?\(([\s\S]+)\)$/.exec(s) || err('Bad filter [' + s + ']');
		const test = compile(vars(m[1]), fns);
		return (ns, root) => ns.flatMap(kids).filter(c => test({ _: c, _root: root }));
	}
	const sl = /^(-?\d*):(-?\d*)(?::(\d+))?$/.exec(s);
	if (sl) {
		const [, a, b, st] = sl;
		return ns => ns.flatMap(n => {
			if (!Array.isArray(n)) return [];
			const out = n.slice(a ? +a : undefined, b ? +b : undefined);
			return st > 1 ? out.filter((x, j) => j % st === 0) : out;
		});
	}
	const q = /^(['"])([\s\S]*)\1$/.exec(s);
	if (q) return ns => ns.flatMap(n => child(n, q[2]));
	if (/^-?\d+$/.test(s)) return ns => ns.flatMap(n => child(n, s));
	err('Bad selector [' + s + ']');
};

/**
 * Compile a JSONPath query once, run it many times.
 *
 * @param {string} path The query, e.g. `'$.store.book[?(@.price < 10)].title'`.
 * @param {Record<string, Function>} [funcs] Functions callable inside filters.
 * @returns {(data?: any) => any[]} Runner returning all matches (empty array for none).
 * @throws {SyntaxError} On malformed paths or filter expressions.
 */
export function query(path, funcs) {
	path = String(path).trim();
	path[0] === '$' || err('Path must start with $');
	const segs = [];
	let j = 1;
	while (j < path.length) {
		let desc = false;
		if (path.startsWith('..', j)) { desc = true; j += 2; }
		else if (path[j] === '.') j++;
		else if (path[j] !== '[') err('Unexpected "' + path[j] + '" in path');
		if (path[j] === '[') {
			const end = close(path, j);
			const sels = split(path.slice(j + 1, end)).map(s => selector(s, funcs));
			segs.push({ desc, apply: (ns, root) => sels.flatMap(sel => sel(ns, root)) });
			j = end + 1;
		} else {
			const m = /^(\*|[A-Za-z_]\w*)/.exec(path.slice(j)) || err('Bad path near index ' + j);
			j += m[1].length;
			const k = m[1];
			segs.push({ desc, apply: k === '*' ? ns => ns.flatMap(kids) : ns => ns.flatMap(n => child(n, k)) });
		}
	}
	return data => segs.reduce((ns, s) => s.apply(s.desc ? ns.flatMap(all) : ns, data), [data]);
}

/**
 * Compile and run a JSONPath query in one go.
 *
 * @param {string} path The query to run.
 * @param {any} [data] The data to query.
 * @param {Record<string, Function>} [funcs] Functions callable inside filters.
 * @returns {any[]} All matches (empty array for none).
 */
export function find(path, data, funcs) {
	return query(path, funcs)(data);
}

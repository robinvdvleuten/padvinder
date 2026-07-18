/**
 * Tiny, CSP-safe JSONPath engine powered by xprsn expressions.
 * Paths and filters compile to a composition of closures; query text is
 * never turned into JavaScript, so strict CSP is satisfied.
 */
import { compile } from 'xprsn';

const BLOCK = k => k === '__proto__' || k === 'constructor' || k === 'prototype';

let err = m => { throw SyntaxError(m) };

// I-Regexp (RFC 9485) `.` matches anything but \n and \r; JavaScript's dot
// also excludes U+2028 and U+2029. Rewrite bare dots outside char classes.
let ire = p => {
	let out = '', cls = false;
	for (let j = 0; j < p.length; j++) {
		const c = p[j];
		if (c === '\\') { out += c + (p[++j] ?? ''); continue; }
		if (c === '[') cls = true;
		else if (c === ']') cls = false;
		out += c === '.' && !cls ? '[^\\n\\r]' : c;
	}
	return out;
};

// Regex test for the `match`/`search` filter functions; a non-string subject
// or an invalid pattern is simply no match.
let reTest = (s, p, anchor) => {
	if (typeof s !== 'string' || typeof p !== 'string') return false;
	try { return new RegExp(anchor ? '^(?:' + ire(p) + ')$' : ire(p), 'u').test(s); } catch { return false; }
};

// Own child values of a node (guarded).
let kids = n => n && typeof n === 'object'
	? (Array.isArray(n) ? [...n] : Object.keys(n).filter(k => !BLOCK(k)).map(k => n[k]))
	: [];

// Node plus all descendants, depth-first. The ancestor set breaks cycles so
// self-referencing data cannot hang recursive descent; it is unwound on exit
// so a node shared by two branches still shows up under both.
let all = (n, seen = new Set()) => {
	if (n && typeof n === 'object') {
		if (seen.has(n)) return [];
		seen.add(n);
	}
	const out = [n, ...kids(n).flatMap(c => all(c, seen))];
	seen.delete(n);
	return out;
};

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
		// RFC-style `?expr` and classic `?(expr)` both parse: parentheses are
		// ordinary grouping in xprsn, so no unwrapping is needed.
		const test = compile(vars(s.slice(1)), fns);
		return (ns, root) => ns.flatMap(kids).filter(c => test({ _: c, _root: root }));
	}
	const sl = /^(-?\d*)\s*:\s*(-?\d*)(?:\s*:\s*(-?\d+)?)?$/.exec(s);
	if (sl) {
		// RFC 9535 slice: negative indexes count from the end, negative steps
		// walk backwards, step 0 selects nothing.
		const st = sl[3] ? +sl[3] : 1;
		return ns => ns.flatMap(n => {
			if (!Array.isArray(n) || !st) return [];
			const len = n.length, norm = x => (x < 0 ? x + len : x), out = [];
			if (st > 0) {
				const lo = Math.min(Math.max(sl[1] ? norm(+sl[1]) : 0, 0), len);
				const hi = Math.min(Math.max(sl[2] ? norm(+sl[2]) : len, 0), len);
				for (let j = lo; j < hi; j += st) out.push(n[j]);
			} else {
				const hi = Math.min(Math.max(sl[1] ? norm(+sl[1]) : len - 1, -1), len - 1);
				const lo = Math.min(Math.max(sl[2] ? norm(+sl[2]) : -1, -1), len - 1);
				for (let j = hi; j > lo; j += st) out.push(n[j]);
			}
			return out;
		});
	}
	const q = /^(['"])([\s\S]*)\1$/.exec(s);
	if (q) {
		// Unescape via JSON, single quotes normalized first (as xprsn does).
		const k = JSON.parse(q[1] === '"' ? s : '"' + q[2].replace(/\\'/g, "'").replace(/"/g, '\\"') + '"');
		return ns => ns.flatMap(n => child(n, k));
	}
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
	// RFC 9535 function extensions, available in every filter. Overridable
	// and extendable via the caller's registry.
	funcs = {
		length: x => typeof x === 'string' ? [...x].length
			: Array.isArray(x) ? x.length
			: x && typeof x === 'object' ? Object.keys(x).length
			: undefined,
		match: (s, p) => reTest(s, p, true),
		search: (s, p) => reTest(s, p, false),
		...funcs,
	};
	path = String(path).trim();
	path[0] === '$' || err('Path must start with $');
	const segs = [];
	let j = 1;
	while (j < path.length) {
		// Whitespace is allowed before a segment, never inside one.
		while (/\s/.test(path[j])) j++;
		let desc = false;
		if (path.startsWith('..', j)) { desc = true; j += 2; }
		else if (path[j] === '.') j++;
		else if (path[j] !== '[') err('Unexpected "' + path[j] + '" in path');
		if (path[j] === '[') {
			const end = close(path, j);
			const sels = split(path.slice(j + 1, end)).map(s => selector(s, funcs));
			// Node-major order (RFC 9535): all selectors run per node before
			// moving to the next node.
			segs.push({ desc, apply: (ns, root) => ns.flatMap(n => sels.flatMap(sel => sel([n], root))) });
			j = end + 1;
		} else {
			const m = /^(\*|[A-Za-z_\u{80}-\u{10FFFF}][\w\u{80}-\u{10FFFF}]*)/u.exec(path.slice(j)) || err('Bad path near index ' + j);
			j += m[1].length;
			const k = m[1];
			segs.push({ desc, apply: k === '*' ? ns => ns.flatMap(kids) : ns => ns.flatMap(n => child(n, k)) });
		}
	}
	return data => segs.reduce((ns, s) => s.apply(s.desc ? ns.flatMap(n => all(n)) : ns, data), [data]);
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

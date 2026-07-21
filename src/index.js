/**
 * Tiny, CSP-safe RFC 9535 JSONPath engine.
 * Paths and filters compile to a composition of closures; query text is
 * never turned into JavaScript, so strict CSP is satisfied.
 */

import { compile as compileRE } from 'treffer';

const BLOCK = k => k === '__proto__' || k === 'constructor' || k === 'prototype';

let err = m => { throw SyntaxError(m) };

// A one-entry cache avoids recompiling a document-supplied pattern per node
// without retaining an attacker-controlled set of patterns.
let reLast, reNfa;
let reTest = (s, p, full) => {
	if (typeof s !== 'string' || typeof p !== 'string') return false;
	if (p.length > 8192) return false;
	try {
		if (p !== reLast) { reLast = p; reNfa = null; reNfa = compileRE(p, { anchors: true }) }
		return reNfa ? (full ? reNfa.match(s) : reNfa.search(s)) : false;
	} catch { return false }
};

// Own child values of a node (guarded). Arrays enumerate own indexes only, so
// a hole never reads an inherited value off the prototype chain.
let kids = n => n && typeof n === 'object'
	? (Array.isArray(n) ? n.flatMap((v, j) => Object.hasOwn(n, j) ? [v] : []) : Object.keys(n).filter(k => !BLOCK(k)).map(k => n[k]))
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
		return Number.isInteger(j) && j >= 0 && j < n.length && Object.hasOwn(n, j) ? [n[j]] : [];
	}
	return Object.hasOwn(n, k) ? [n[k]] : [];
};

// RFC 9535 quoted string → value. Escaped quotes must match the delimiter,
// and the decoded value must contain only Unicode scalar values.
let unq = s => {
	const q = s[0], end = s.length - 1;
	let out = '', bad = () => err('Invalid string literal');
	for (let j = 1; j < end; j++) {
		let c = s[j];
		if (c === '\\') {
			c = s[++j];
			if (c === q) out += c;
			else if ('bfnrt/\\'.includes(c)) out += c === 'b' ? '\b' : c === 'f' ? '\f' : c === 'n' ? '\n' : c === 'r' ? '\r' : c === 't' ? '\t' : c;
			else if (c === 'u' && /^[\da-f]{4}$/i.test(s.slice(j + 1, j + 5))) {
				const a = parseInt(s.slice(j + 1, j + 5), 16);
				j += 4;
				if (a >= 0xd800 && a <= 0xdbff) {
					(s.slice(j + 1, j + 3) === '\\u' && /^[\da-f]{4}$/i.test(s.slice(j + 3, j + 7))) || bad();
					const b = parseInt(s.slice(j + 3, j + 7), 16);
					(b >= 0xdc00 && b <= 0xdfff) || bad();
					out += String.fromCharCode(a, b);
					j += 6;
				} else {
					(a < 0xdc00 || a > 0xdfff) || bad();
					out += String.fromCharCode(a);
				}
			} else bad();
		} else {
			(c >= ' ' && c !== q) || bad();
			const a = c.charCodeAt();
			if (a >= 0xd800 && a <= 0xdbff) {
				const b = s.charCodeAt(j + 1);
				(b >= 0xdc00 && b <= 0xdfff) || bad();
				out += c + s[++j];
			} else {
				(a < 0xdc00 || a > 0xdfff) || bad();
				out += c;
			}
		}
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
		// `?expr` and the classic `?(expr)` both parse: parentheses are ordinary
		// grouping in the filter grammar, so no unwrapping is needed.
		const test = rfcFilter(s.slice(1), fns);
		return (ns, root) => ns.flatMap(kids).filter(c => test(c, root));
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
				for (let j = lo; j < hi; j += st) if (Object.hasOwn(n, j)) out.push(n[j]);
			} else {
				const hi = Math.min(Math.max(sl[1] ? norm(+sl[1]) : len - 1, -1), len - 1);
				const lo = Math.min(Math.max(sl[2] ? norm(+sl[2]) : -1, -1), len - 1);
				for (let j = hi; j > lo; j += st) if (Object.hasOwn(n, j)) out.push(n[j]);
			}
			return out;
		});
	}
	const q = /^(['"])([\s\S]*)\1$/.exec(s);
	// RFC 9535 typing: a quoted name selects only from objects, an index only
	// from arrays.
	if (q) {
		const k = unq(s);
		return ns => ns.flatMap(n => Array.isArray(n) ? [] : child(n, k));
	}
	if (/^-?\d+$/.test(s)) return ns => ns.flatMap(n => Array.isArray(n) ? child(n, s) : []);
	err('Bad selector [' + s + ']');
};

// Parse consecutive segments starting at index `j`; returns the compiled
// segments plus where parsing stopped. Top level (`soft` false) errors on any
// unexpected character. Soft mode instead stops at the first character that
// cannot start a segment, so embedded queries inside filters can end
// mid-string (before an operator, `)`, `]`, or `,`).
let segments = (path, j, fns, soft) => {
	const segs = [];
	while (j < path.length) {
		const back = j;
		// Whitespace is allowed before a segment, never inside one.
		while (/\s/.test(path[j])) j++;
		let desc = false;
		if (path.startsWith('..', j)) { desc = true; j += 2; }
		else if (path[j] === '.') j++;
		else if (path[j] !== '[') {
			if (soft) return { segs, j: back };
			err('Unexpected "' + path[j] + '" in path');
		}
		if (path[j] === '[') {
			const end = close(path, j);
			const raw = split(path.slice(j + 1, end));
			const sels = raw.map(s => selector(s, fns));
			// Singular per RFC 9535: one selector, and it is a name or index.
			const sing = !desc && raw.length === 1 && (/^-?\d+$/.test(raw[0]) || /^["']/.test(raw[0]));
			// Node-major order (RFC 9535): all selectors run per node before
			// moving to the next node.
			segs.push({ desc, sing, apply: (ns, root) => ns.flatMap(n => sels.flatMap(sel => sel([n], root))) });
			j = end + 1;
		} else {
			const m = /^(\*|[A-Za-z_\u{80}-\u{10FFFF}][\w\u{80}-\u{10FFFF}]*)/u.exec(path.slice(j)) || err('Bad path near index ' + j);
			j += m[1].length;
			const k = m[1];
			segs.push({ desc, sing: !desc && k !== '*', apply: k === '*' ? ns => ns.flatMap(kids) : ns => ns.flatMap(n => child(n, k)) });
		}
	}
	return { segs, j };
};

// Run compiled segments over a start nodelist.
let run = (segs, ns, root) => segs.reduce((acc, s) => s.apply(s.desc ? acc.flatMap(n => all(n)) : acc, root), ns);

// ---- RFC 9535 filter grammar ----
// Missing values are a distinct "Nothing", not undefined: undefined is a
// value JS data can actually hold.
const NOTHING = Symbol();

// Deep structural equality per RFC 9535. Own keys only, through the guard,
// so `__proto__` keys in data stay inert here too.
let deepEq = (a, b) => {
	if (a === b) return true;
	if (Array.isArray(a) && Array.isArray(b))
		return a.length === b.length && a.every((x, j) => deepEq(x, b[j]));
	if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
		const ka = Object.keys(a).filter(k => !BLOCK(k)), kb = Object.keys(b).filter(k => !BLOCK(k));
		return ka.length === kb.length && ka.every(k => Object.hasOwn(b, k) && deepEq(a[k], b[k]));
	}
	return false;
};

// RFC comparison semantics: == is deep, Nothing only equals Nothing, and the
// orderings apply to two numbers or two strings, nothing else.
let cmp = (op, a, b) =>
	op === '==' ? (a === NOTHING || b === NOTHING ? a === b : deepEq(a, b)) :
	op === '!=' ? !cmp('==', a, b) :
	op === '<=' ? cmp('==', a, b) || cmp('<', a, b) :
	op === '>=' ? cmp('==', a, b) || cmp('<', b, a) :
	op === '>' ? cmp('<', b, a) :
	(typeof a === typeof b && (typeof a === 'number' || typeof a === 'string') && a < b); // <

// The five built-in RFC function extensions with their argument and return
// types. A name absent here is looked up in the caller's registry instead.
const RFCFN = {
	length: { args: ['value'], ret: 'value', make: ([a]) => (n, r) => {
		const v = a(n, r);
		return typeof v === 'string' ? [...v].length
			: Array.isArray(v) ? v.length
			: v && typeof v === 'object' ? Object.keys(v).length
			: NOTHING;
	} },
	count: { args: ['nodes'], ret: 'value', make: ([a]) => (n, r) => a(n, r).length },
	value: { args: ['nodes'], ret: 'value', make: ([a]) => (n, r) => {
		const ns = a(n, r);
		return ns.length === 1 ? ns[0] : NOTHING;
	} },
	match: { args: ['value', 'value'], ret: 'logical', make: ([a, b]) => (n, r) => reTest(a(n, r), b(n, r), true) },
	search: { args: ['value', 'value'], ret: 'logical', make: ([a, b]) => (n, r) => reTest(a(n, r), b(n, r), false) },
};

// Parse one filter body as the RFC grammar, producing (node, root) => boolean.
// Throws SyntaxError on anything that is not valid RFC 9535 filter syntax.
let rfcFilter = (src, fns) => {
	let k = 0;
	const fail = () => err('Bad filter: ' + src);
	const ws = () => { while (/\s/.test(src[k])) k++; };
	const eat = c => src.startsWith(c, k) && (k += c.length, !0);

	// `@` or `$` plus segments; runs to a nodelist.
	const queryExpr = () => {
		const abs = src[k++] === '$';
		const { segs, j } = segments(src, k, fns, !0);
		k = j;
		return {
			sing: segs.every(s => s.sing),
			run: (n, r) => run(segs, [abs ? r : n], r),
		};
	};

	// Literal number, string, or keyword; undefined when none matches.
	const literal = () => {
		const m = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(src.slice(k));
		if (m && !/[\w.]/.test(src[k + m[0].length] ?? '')) {
			k += m[0].length;
			const v = +m[0];
			return () => v;
		}
		if (src[k] === '"' || src[k] === "'") {
			let j = k + 1;
			for (; j < src.length && src[j] !== src[k]; j++) if (src[j] === '\\') j++;
			j < src.length || fail();
			const v = unq(src.slice(k, j + 1));
			k = j + 1;
			return () => v;
		}
		for (const [w, v] of [['true', !0], ['false', !1], ['null', null]])
			if (src.startsWith(w, k) && !/\w/.test(src[k + w.length] ?? '')) {
				k += w.length;
				return () => v;
			}
	};

	// name(args) with RFC typing; `arg` parses one argument of the given type.
	const arg = type => {
		ws();
		if (src[k] === '@' || src[k] === '$') {
			const q = queryExpr();
			if (type === 'nodes') return (n, r) => q.run(n, r);
			q.sing || fail();
			return (n, r) => { const ns = q.run(n, r); return ns.length ? ns[0] : NOTHING; };
		}
		type === 'nodes' && fail();
		const lit = literal();
		if (lit) return lit;
		const f = funcExpr();
		f.type === 'value' || fail();
		return f.fn;
	};
	const funcExpr = () => {
		const m = /^[a-z][a-z0-9_]*/.exec(src.slice(k)) || fail();
		k += m[0].length;
		ws(); eat('(') || fail();
		// Own-property lookup only: a name like `constructor` must not resolve
		// to an inherited Object.prototype member.
		const spec = Object.hasOwn(RFCFN, m[0]) ? RFCFN[m[0]] : undefined;
		if (spec) {
			const args = spec.args.map((t, x) => (x && (ws(), eat(',') || fail()), arg(t)));
			ws(); eat(')') || fail();
			return { type: spec.ret, fn: spec.make(args) };
		}
		// Registered function extension: value-type args, and its result may be
		// used as a value or (unlike the built-ins) as a truthiness test.
		Object.hasOwn(fns, m[0]) || err(m[0] + ' is not a function');
		const f = fns[m[0]], args = [];
		ws();
		if (!eat(')')) {
			do args.push(arg('value')); while (ws(), eat(','));
			ws(); eat(')') || fail();
		}
		return { type: 'user', fn: (n, r) => f(...args.map(a => a(n, r))) };
	};

	// A comparable/test primary: query, literal, or function call.
	const primary = () => {
		ws();
		if (src[k] === '@' || src[k] === '$') return { q: queryExpr() };
		const lit = literal();
		if (lit) return { v: lit };
		const f = funcExpr();
		return f.type === 'logical' ? { l: f.fn } : f.type === 'user' ? { v: f.fn, u: !0 } : { v: f.fn };
	};
	// ValueType position: literals, value functions, and singular queries only.
	const asValue = p => {
		if (p.v) return p.v;
		p.q && p.q.sing || fail();
		const q = p.q;
		return (n, r) => { const ns = q.run(n, r); return ns.length ? ns[0] : NOTHING; };
	};

	const basic = () => {
		ws();
		let neg = !1;
		while (eat('!')) { neg = !neg; ws(); }
		if (eat('(')) {
			const e = or();
			ws(); eat(')') || fail();
			return neg ? (n, r) => !e(n, r) : e;
		}
		const p = primary();
		ws();
		const op = ['==', '!=', '<=', '>=', '<', '>'].find(o => src.startsWith(o, k));
		if (op) {
			neg && fail();
			k += op.length;
			const a = asValue(p), b = asValue(primary());
			return (n, r) => cmp(op, a(n, r), b(n, r));
		}
		// Test position: a query is an existence test, a logical function is
		// itself, a registered function is truthiness-tested; a bare literal or
		// a built-in value function is not a valid test.
		const t = p.q ? ((q => (n, r) => q.run(n, r).length > 0)(p.q)) : p.u ? p.v : (p.l || fail());
		return neg ? (n, r) => !t(n, r) : t;
	};
	const and = () => {
		let l = basic();
		for (ws(); eat('&&'); ws()) { const a = l, b = basic(); l = (n, r) => a(n, r) && b(n, r); }
		return l;
	};
	const or = () => {
		let l = and();
		for (ws(); eat('||'); ws()) { const a = l, b = and(); l = (n, r) => a(n, r) || b(n, r); }
		return l;
	};

	const e = or();
	ws();
	k === src.length || fail();
	return e;
};

/**
 * Compile a JSONPath query once, run it many times.
 *
 * @param {string} path The query, e.g. `'$.store.book[?@.price < 10].title'`.
 * @param {Record<string, Function>} [funcs] Custom function extensions callable in filters, alongside the built-in `length`, `count`, `value`, `match`, and `search`.
 * @returns {(data?: any) => any[]} Runner returning all matches (empty array for none).
 * @throws {SyntaxError} On malformed paths or filters.
 */
export function query(path, funcs) {
	funcs = funcs || {};
	path = String(path).trim();
	path[0] === '$' || err('Path must start with $');
	const { segs } = segments(path, 1, funcs, false);
	return data => run(segs, [data], data);
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

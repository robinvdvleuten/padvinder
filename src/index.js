/**
 * Tiny, CSP-safe, zero-dependency RFC 9535 JSONPath engine.
 * Paths and filters compile to a composition of closures; query text is
 * never turned into JavaScript, so strict CSP is satisfied.
 */

const BLOCK = k => k === '__proto__' || k === 'constructor' || k === 'prototype';

let err = m => { throw SyntaxError(m) };

const RE_PROP = /^(?:L[lmotu]?|M[cen]?|N[dlo]?|P[cdefios]?|Z[lps]?|S[ckmo]?|C[cfno]?)$/;
const RE_MAX = 4096, RE_DEPTH = 64, RE_REPEAT = 1024, RE_STEPS = 1e6;
let reBad = () => { throw 0 };

// Count Unicode scalar values without allocating, rejecting lone surrogates.
let scalarCount = (s, max) => {
	let count = 0;
	for (let j = 0; j < s.length; j++) {
		const a = s.charCodeAt(j);
		if (a >= 0xd800 && a <= 0xdbff) {
			const b = s.charCodeAt(++j);
			(b >= 0xdc00 && b <= 0xdfff) || reBad();
		} else if (a >= 0xdc00 && a <= 0xdfff) reBad();
		++count <= max || reBad();
	}
	return count;
};
let scalars = (s, max) => {
	scalarCount(s, max);
	return Array.from(s);
};

// Parse RFC 9485 I-Regexp plus the ^/$ anchors pinned by the JSONPath CTS.
let reParse = src => {
	src.length <= RE_MAX * 2 || reBad();
	const s = scalars(src, RE_MAX);
	let i = 0, depth = 0;
	const lit = c => ({ t: 'c', p: x => x === c });
	const prop = (neg, p) => {
		RE_PROP.test(p) || reBad();
		const r = new RegExp('^\\' + (neg ? 'P' : 'p') + '{' + p + '}$', 'u');
		return { p: c => r.test(c) };
	};
	const esc = () => {
		const c = s[i++] ?? reBad();
		if ((c === 'p' || c === 'P') && s[i] === '{') {
			i++;
			let p = '';
			while (i < s.length && s[i] !== '}') p += s[i++];
			s[i++] === '}' || reBad();
			return prop(c === 'P', p);
		}
		'()*+-.?[\\]^nrt{|}'.includes(c) || reBad();
		const v = c === 'n' ? '\n' : c === 'r' ? '\r' : c === 't' ? '\t' : c;
		return { p: x => x === v, c: v };
	};
	const cls = () => {
		let neg = s[i] === '^', ps = [], any = false;
		if (neg) i++;
		const one = () => {
			const c = s[i++];
			if (c === '\\') return esc();
			(c != null && c !== '[' && c !== ']' && c !== '-') || reBad();
			return { p: x => x === c, c };
		};
		if (s[i] === '-') { ps.push(x => x === '-'); i++; any = true; }
		while (i < s.length && s[i] !== ']') {
			if (s[i] === '-' && s[i + 1] === ']') {
				ps.push(x => x === '-'); i++; any = true; continue;
			}
			const a = one();
			if (s[i] === '-' && s[i + 1] !== ']') {
				i++;
				const b = one();
				(a.c != null && b.c != null && a.c.codePointAt() <= b.c.codePointAt()) || reBad();
				const lo = a.c.codePointAt(), hi = b.c.codePointAt();
				ps.push(x => { const n = x.codePointAt(); return n >= lo && n <= hi });
			} else ps.push(a.p);
			any = true;
		}
		(any && s[i++] === ']') || reBad();
		return { t: 'c', p: (c, spend) => {
			let yes = false;
			for (const p of ps) {
				spend();
				if (p(c)) { yes = true; break }
			}
			return neg !== yes;
		} };
	};
	const number = () => {
		let n = 0, d = 0;
		while (i < s.length && s[i] >= '0' && s[i] <= '9') {
			++d <= 6 || reBad();
			n = n * 10 + +s[i++];
			n <= RE_REPEAT || reBad();
		}
		d || reBad();
		return n;
	};
	let alt;
	const atom = () => {
		const c = s[i++];
		if (c === '(') {
			++depth <= RE_DEPTH || reBad();
			const n = alt();
			s[i++] === ')' || reBad();
			depth--;
			return n;
		}
		if (c === '[') return cls();
		if (c === '\\') { const e = esc(); return { t: 'c', p: e.p } }
		if (c === '.') return { t: 'c', p: x => x !== '\n' && x !== '\r' };
		if (c === '^' || c === '$') return { t: 'z', a: c === '$' };
		(c != null && !'()[]|*+?{}'.includes(c)) || reBad();
		return lit(c);
	};
	const piece = () => {
		const a = atom(), c = s[i];
		let lo, hi;
		if (c === '*' || c === '+' || c === '?') {
			i++;
			lo = c === '+' ? 1 : 0;
			hi = c === '?' ? 1 : -1;
		} else if (c === '{') {
			i++;
			lo = number();
			if (s[i] === ',') {
				i++;
				hi = s[i] === '}' ? -1 : number();
			} else hi = lo;
			s[i++] === '}' || reBad();
			(hi < 0 || lo <= hi) || reBad();
		} else return a;
		return { t: 'q', a, lo, hi };
	};
	const branch = () => {
		const v = [];
		while (i < s.length && s[i] !== '|' && s[i] !== ')') v.push(piece());
		return v.length ? { t: 'n', v } : { t: 'e' };
	};
	alt = () => {
		const v = [branch()];
		while (s[i] === '|') { i++; v.push(branch()) }
		return v.length > 1 ? { t: 'a', v } : v[0];
	};
	const out = alt();
	i === s.length || reBad();
	return out;
};

// Compile the parsed expression to a bounded Thompson NFA.
let reCompile = p => {
	const ast = reParse(p), st = [];
	const add = (t, x = -1, y = -1, v) => {
		st.length < RE_MAX || reBad();
		return st.push([t, x, y, v]) - 1;
	};
	const patch = (o, x) => o.forEach(([j, k]) => { st[j][k] = x });
	const empty = () => { const j = add(0); return { s: j, o: [[j, 1]] } };
	const cat = (a, b) => (patch(a.o, b.s), { s: a.s, o: b.o });
	const build = n => {
		if (n.t === 'e') return empty();
		if (n.t === 'c') { const j = add(1, -1, -1, n.p); return { s: j, o: [[j, 1]] } }
		if (n.t === 'z') { const j = add(2, -1, -1, n.a); return { s: j, o: [[j, 1]] } }
		if (n.t === 'n') return n.v.reduce((a, x) => cat(a, build(x)), empty());
		if (n.t === 'a') {
			let a = build(n.v[0]);
			for (let k = 1; k < n.v.length; k++) {
				const b = build(n.v[k]), j = add(0, a.s, b.s);
				a = { s: j, o: a.o.concat(b.o) };
			}
			return a;
		}
		let a = empty();
		for (let k = 0; k < n.lo; k++) a = cat(a, build(n.a));
		if (n.hi < 0) {
			const b = build(n.a), j = add(0, b.s);
			patch(a.o, j); patch(b.o, j);
			return { s: a.s, o: [[j, 2]] };
		}
		for (let k = n.lo; k < n.hi; k++) {
			const b = build(n.a), j = add(0, b.s);
			patch(a.o, j);
			a = { s: a.s, o: b.o.concat([[j, 2]]) };
		}
		return a;
	};
	const f = build(ast), end = add(3);
	patch(f.o, end);
	return { st, start: f.s, end };
};

// Simulate all active NFA states. Search adds the start state at each input
// position in one pass; it never restarts over a suffix.
let reRun = (nfa, str, full) => {
	scalarCount(str, RE_STEPS);
	const { st, start, end } = nfa, len = str.length;
	let cur = new Set(), steps = 0;
	const spend = () => { ++steps <= RE_STEPS || reBad() };
	const add = (set, root, pos) => {
		const todo = [root], seen = new Set();
		while (todo.length) {
			const j = todo.pop();
			if (j < 0 || seen.has(j)) continue;
			seen.add(j);
			spend();
			const q = st[j];
			if (q[0] === 0) { todo.push(q[1], q[2]); continue }
			if (q[0] === 2) { (q[3] ? pos === len : pos === 0) && todo.push(q[1]); continue }
			set.add(j);
		}
	};
	if (full) add(cur, start, 0);
	for (let pos = 0; pos <= len;) {
		full || add(cur, start, pos);
		if (cur.has(end) && (!full || pos === len)) return true;
		if (pos === len) break;
		const n = str.codePointAt(pos), c = String.fromCodePoint(n);
		const nextPos = pos + (n > 0xffff ? 2 : 1);
		const next = new Set();
		for (const j of cur) {
			spend();
			const q = st[j];
			if (q[0] === 1 && q[3](c, spend)) add(next, q[1], nextPos);
		}
		cur = next;
		pos = nextPos;
	}
	return false;
};

// A one-entry cache avoids recompiling a document-supplied pattern per node
// without retaining an attacker-controlled set of patterns.
let reLast, reNfa;
let reTest = (s, p, full) => {
	if (typeof s !== 'string' || typeof p !== 'string') return false;
	if (p.length > RE_MAX * 2) return false;
	try {
		if (p !== reLast) { reLast = p; reNfa = null; reNfa = reCompile(p) }
		return reNfa ? reRun(reNfa, s, full) : false;
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

// Quoted string → value. Unescape via JSON, single quotes normalized first.
let unq = s => JSON.parse(s[0] === '"' ? s : '"' + s.slice(1, -1).replace(/\\'/g, "'").replace(/"/g, '\\"') + '"');

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

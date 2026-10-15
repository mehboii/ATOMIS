/** Independent value-name resolution on lowered Atomis text. No target checker. */
import { tokenize, Token, TokenType } from './lexer';
import { Diagnostic } from './analyzer';
import { LineMapping } from './transformer';
const GLOBALS = new Set('undefined NaN Infinity globalThis console Math JSON Number String Boolean BigInt Symbol Object Array Function Date RegExp Error TypeError RangeError SyntaxError ReferenceError URIError EvalError Promise Map Set WeakMap WeakSet ArrayBuffer SharedArrayBuffer DataView Uint8Array Uint8ClampedArray Uint16Array Uint32Array Int8Array Int16Array Int32Array Float32Array Float64Array BigInt64Array BigUint64Array Atomics Reflect Proxy Intl parseInt parseFloat isNaN isFinite decodeURI decodeURIComponent encodeURI encodeURIComponent eval require module exports __dirname __filename process Buffer global setTimeout clearTimeout setInterval clearInterval setImmediate clearImmediate queueMicrotask structuredClone fetch URL URLSearchParams TextEncoder TextDecoder AbortController AbortSignal WebAssembly GhostNode GhostChannel GhostMesh setEncryptionPolicy __atomis_cell'.split(' '));
const WORDS = new Set('let const var function async await return throw if else for while do switch case default break continue try catch finally new delete void typeof instanceof in of true false null this super class extends implements static public private protected readonly abstract declare export import from as type interface enum namespace keyof infer is asserts satisfies yield debugger with'.split(' '));
interface Region {
    lo: number;
    hi: number;
    fn: boolean;
    names: Map<string, boolean>;
}
// Expand only template expressions; literal text, comments and regex are not names.
function expanded(source: string, depth = 0): Token[] {
    if (depth > 64)
        return [];
    const result: Token[] = [];
    for (const t of tokenize(source)) {
        if (t.type !== TokenType.STRING || t.value.charCodeAt(0) !== 96) {
            if (![TokenType.COMMENT, TokenType.EOF].includes(t.type))
                result.push(t);
            continue;
        }
        const text = t.value;
        for (let i = 1; i < text.length - 1; i++) {
            if (text[i] === '\\') {
                i++;
                continue;
            }
            if (text[i] !== '$' || text[i + 1] !== '{')
                continue;
            const start = i + 2;
            let balance = 1, end = text.length - 1;
            for (const q of tokenize(text.slice(start))) {
                if (q.value === '{')
                    balance++;
                if (q.value === '}' && --balance === 0) {
                    end = start + q.start;
                    break;
                }
            }
            const lines = text.slice(0, start).split('\n');
            for (const q of expanded(text.slice(start, end), depth + 1)) {
                result.push({ ...q, start: t.start + start + q.start, end: t.start + start + q.end,
                    line: t.line + lines.length - 1 + q.line - 1,
                    col: q.line === 1 ? (lines.length === 1 ? t.col - 1 : 0) + lines[lines.length - 1].length + q.col : q.col });
            }
            i = end;
        }
    }
    return result;
}
export function validateNames(code: string, mappings: LineMapping[]): Diagnostic[] {
    const ts = expanded(code), n = ts.length, pairs = new Map<number, number>(), stack: number[] = [];
    const value = (i: number) => ts[i]?.value ?? '';
    for (let i = 0; i < n; i++) {
        if (['(', '[', '{'].includes(value(i)))
            stack.push(i);
        if ([')', ']', '}'].includes(value(i))) {
            const j = stack.pop();
            if (j !== undefined) {
                pairs.set(j, i);
                pairs.set(i, j);
            }
        }
    }
    const regions: Region[] = [{ lo: 0, hi: n, fn: true, names: new Map() }];
    for (let i = 0; i < n; i++)
        if (value(i) === '{' && pairs.has(i))
            regions.push({ lo: i, hi: pairs.get(i)!, fn: false, names: new Map() });
    const ignored = new Set<number>(), declared = new Set<number>();
    const issues: {
        i: number;
        message: string;
    }[] = [];
    const region = (i: number, functionOnly = false): Region => regions.filter(s => s.lo <= i && i <= s.hi && (!functionOnly || s.fn)).sort((a, b) => (a.hi - a.lo) - (b.hi - b.lo))[0];
    const ignore = (lo: number, hi: number) => { for (let j = lo; j < hi; j++)
        ignored.add(j); };
    const next = (i: number) => { while (ts[i]?.type === TokenType.NEWLINE)
        i++; return i; };
    const endStatement = (i: number): number => {
        if (value(i) === '{')
            return pairs.get(i) ?? i;
        for (; i < n; i++) {
            if (value(i) === ';' || ts[i].type === TokenType.NEWLINE || value(i) === '}')
                return i;
            if (pairs.has(i) && pairs.get(i)! > i)
                i = pairs.get(i)!;
        }
        return n;
    };
    for (let i = 0; i < n; i++)
        if (['for', 'catch'].includes(value(i))) {
            let open = next(i + 1);
            if (value(open) === 'await')
                open = next(open + 1);
            const close = pairs.get(open);
            if (value(open) === '(' && close !== undefined)
                regions.push({ lo: open, hi: endStatement(next(close + 1)), fn: false, names: new Map() });
        }
    const functions: {
        open: number;
        close: number;
        scope: Region;
        name?: number;
        expression?: boolean;
    }[] = [];
    const arrowEnd = (start: number): number => {
        if (value(start) === '{')
            return pairs.get(start) ?? start;
        for (let j = start; j < n; j++) {
            if ([';', ',', ')', ']', '}'].includes(value(j)) || ts[j].type === TokenType.NEWLINE)
                return Math.max(start, j - 1);
            if (pairs.has(j) && pairs.get(j)! > j)
                j = pairs.get(j)!;
        }
        return n;
    };
    for (let i = 0; i < n; i++) {
        if (value(i) === 'function') {
            let j = next(i + 1);
            if (value(j) === '*')
                j = next(j + 1);
            const name = value(j) === '(' ? undefined : j;
            if (name !== undefined)
                j = next(j + 1);
            const close = pairs.get(j);
            if (value(j) !== '(' || close === undefined)
                continue;
            let body = next(close + 1);
            while (body < n && !['{', ';'].includes(value(body)) && ts[body].type !== TokenType.NEWLINE) {
                if (pairs.has(body) && pairs.get(body)! > body)
                    body = pairs.get(body)!;
                body++;
            }
            const hi = pairs.get(body);
            if (hi === undefined)
                continue;
            const s = { lo: j, hi, fn: true, names: new Map<string, boolean>() };
            regions.push(s);
            const b = regions.find(r => r.lo === body && r.hi === hi);
            if (b)
                regions.splice(regions.indexOf(b), 1);
            ignore(close + 1, body);
            functions.push({ open: j, close, scope: s, name, expression: ['=', '(', ':', ',', 'return'].includes(value(i - 1)) });
        }
        if (value(i) === '=>') {
            const close = i - 1, open = value(close) === ')' ? pairs.get(close)! : close;
            const body = next(i + 1), hi = arrowEnd(body);
            const s = { lo: open, hi, fn: true, names: new Map<string, boolean>() };
            regions.push(s);
            const b = regions.find(r => r.lo === body && r.hi === (pairs.get(body) ?? -1));
            if (b)
                regions.splice(regions.indexOf(b), 1);
            functions.push({ open: value(close) === ')' ? open : open - 1, close: value(close) === ')' ? close : close + 1, scope: s });
        }
    }
    // Method property names are not lexical references; their parameters are local.
    for (let i = 0; i < n; i++) {
        if (![TokenType.IDENT, TokenType.KEYWORD].includes(ts[i].type) || WORDS.has(value(i)) && value(i) !== "constructor" || value(i + 1) !== "(" || [".", "?.", "function"].includes(value(i - 1)))
            continue;
        const close = pairs.get(i + 1);
        if (close === undefined || functions.some(f => f.close === close))
            continue;
        let body = next(close + 1);
        if (value(body) === ":") {
            body++;
            while (body < n && value(body) !== "{" && ts[body].type !== TokenType.NEWLINE) {
                if (pairs.has(body) && pairs.get(body)! > body)
                    body = pairs.get(body)!;
                body++;
            }
        }
        if (value(body) !== "{" || !pairs.has(body))
            continue;
        const hi = pairs.get(body)!, scope = regions.find(r => r.lo === body && r.hi === hi)!;
        scope.lo = i + 1;
        scope.fn = true;
        ignored.add(i);
        ignore(close + 1, body);
        functions.push({ open: i + 1, close, scope, expression: true });
    }
    const declare = (i: number, s: Region, constant: boolean) => {
        if (!ts[i] || declared.has(i))
            return;
        declared.add(i);
        if (s.names.has(value(i)))
            issues.push({ i, message: "'" + value(i) + "' is already declared in this scope" });
        s.names.set(value(i), constant);
    };
    const typeEnd = (i: number, end: number) => {
        let angles = 0;
        for (; i < end; i++) {
            const v = value(i);
            if (v === '<')
                angles++;
            if (v === '>')
                angles--;
            if (angles === 0 && ['=', ',', ';', ')', 'in', 'of', '=>', '+', '-', '*', '/', '%', '&&', '||', '??', '===', '!==', '==', '!=', '}'].includes(v))
                break;
            if (angles === 0 && ts[i].type === TokenType.NEWLINE)
                break;
            if (pairs.has(i) && pairs.get(i)! > i)
                i = pairs.get(i)!;
        }
        return i;
    };
    const binding = (start: number, end: number, s: Region, constant: boolean): number => {
        let i = next(start);
        if (value(i) === '...')
            i++;
        if (['{', '['].includes(value(i))) {
            const close = pairs.get(i) ?? i;
            for (let j = i + 1; j < close;) {
                if ([',', '...'].includes(value(j)) || ts[j].type === TokenType.NEWLINE) {
                    j++;
                    continue;
                }
                if (value(j + 1) === ':') {
                    ignored.add(j);
                    j += 2;
                }
                const old = j;
                j = binding(j, close, s, constant);
                if (j <= old)
                    j = old + 1;
                if (value(j) === '=') {
                    j++;
                    while (j < close && value(j) !== ',') {
                        if (pairs.has(j) && pairs.get(j)! > j)
                            j = pairs.get(j)!;
                        j++;
                    }
                }
                if (value(j) === ',')
                    j++;
            }
            i = close + 1;
        }
        else {
            declare(i, s, constant);
            i++;
        }
        if (value(i) === '?') {
            ignored.add(i);
            i++;
        }
        if (value(i) === ':') {
            const endType = typeEnd(i + 1, end);
            ignore(i, endType);
            i = endType;
        }
        return i;
    };
    for (const f of functions) {
        if (f.name !== undefined)
            declare(f.name, f.expression ? f.scope : region(f.name), false);
        for (let j = f.open + 1; j < f.close;) {
            if (value(j) === ',' || ts[j].type === TokenType.NEWLINE) {
                j++;
                continue;
            }
            const old = j;
            j = binding(j, f.close, f.scope, false);
            if (value(j) === '=') {
                j++;
                while (j < f.close && value(j) !== ',') {
                    if (pairs.has(j) && pairs.get(j)! > j)
                        j = pairs.get(j)!;
                    j++;
                }
            }
            if (j <= old)
                j++;
        }
    }
    for (let i = 0; i < n; i++) {
        if (ignored.has(i))
            continue;
        const v = value(i);
        if (['let', 'const', 'var'].includes(v)) {
            const end = endStatement(i + 1), s = region(i, v === 'var');
            let j = i + 1;
            while (j < end) {
                j = binding(j, end, s, v === 'const');
                if (value(j) === '=') {
                    j++;
                    while (j < end && ![',', ';', 'in', 'of'].includes(value(j))) {
                        if (pairs.has(j) && pairs.get(j)! > j)
                            j = pairs.get(j)!;
                        j++;
                    }
                }
                if (value(j) !== ',')
                    break;
                j++;
            }
        }
        if (['as', 'satisfies'].includes(v)) {
            const end = typeEnd(i + 1, n);
            ignore(i, end);
        }
        if (value(i + 1) === ':' || value(i + 1) === '=') {
            const owner = region(i);
            const before = code.slice(0, ts[owner.lo]?.start ?? 0);
            if (value(owner.lo) === '{' && /\bclass\s+[A-Za-z_$][\w$]*(?:\s+extends\s+[A-Za-z_$][\w$.]*)?\s*$/.test(before)) {
                ignored.add(i);
                if (value(i + 1) === ':') {
                    const end = typeEnd(i + 2, n);
                    ignore(i + 1, end);
                }
            }
        }
        if (v === 'catch' && value(i + 1) === '(')
            binding(i + 2, pairs.get(i + 1) ?? i + 2, region(i + 1), false);
        if (['class', 'enum', 'namespace', 'interface', 'type'].includes(v) && ts[i + 1]?.type === TokenType.IDENT) {
            declare(i + 1, region(i), false);
            if (['interface', 'type'].includes(v)) {
                const end = endStatement(i + 2);
                ignore(i + 2, end);
            }
        }
        if (v === 'import') {
            let end = i + 1;
            while (end < n && ts[end].type !== TokenType.STRING && ts[end].type !== TokenType.NEWLINE)
                end++;
            for (let j = i + 1; j < end; j++)
                if ([TokenType.IDENT, TokenType.KEYWORD].includes(ts[j].type) && !['from', 'as', 'type'].includes(value(j)) && value(j + 1) !== 'as')
                    declare(j, region(i), true);
            ignore(i, end + 1);
        }
    }
    for (let i = 0; i < n; i++) {
        if (ignored.has(i) || declared.has(i) || ![TokenType.IDENT, TokenType.KEYWORD].includes(ts[i].type) || WORDS.has(value(i)))
            continue;
        if (['.', '?.'].includes(value(i - 1)))
            continue;
        let previous = i - 1;
        while (previous >= 0 && ts[previous].type === TokenType.NEWLINE)
            previous--;
        if (value(i + 1) === ':' && ['{', ',', ';', '}'].includes(value(previous)))
            continue;
        const scopes = regions.filter(s => s.lo <= i && i <= s.hi).sort((a, b) => (a.hi - a.lo) - (b.hi - b.lo));
        const owner = scopes.find(s => s.names.has(value(i)));
        if (!owner && !GLOBALS.has(value(i)))
            issues.push({ i, message: "Undefined identifier '" + value(i) + "'" });
        if (owner?.names.get(value(i)) && (['=', '+=', '-=', '*=', '/=', '%=', '**=', '&&=', '||=', '??=', '++', '--'].includes(value(i + 1)) || ['++', '--'].includes(value(i - 1))))
            issues.push({ i, message: "Cannot assign to constant '" + value(i) + "'" });
    }
    return issues.sort((a, b) => a.i - b.i).map(({ i, message }) => ({ message, severity: 'error', line: mappings.find(m => m.generatedLine === ts[i].line)?.originalLine ?? ts[i].line, col: 1 }));
}

//! Independent name resolution. Keep rules paired with src/name-check.ts.
use crate::analyzer::{Diagnostic, Severity};
use crate::lexer::{tokenize, Token, TokenType};
use crate::transformer::LineMapping;
use std::collections::{HashMap, HashSet};
const GLOBALS: &str = "undefined NaN Infinity globalThis console Math JSON Number String Boolean BigInt Symbol Object Array Function Date RegExp Error TypeError RangeError SyntaxError ReferenceError URIError EvalError Promise Map Set WeakMap WeakSet ArrayBuffer SharedArrayBuffer DataView Uint8Array Uint8ClampedArray Uint16Array Uint32Array Int8Array Int16Array Int32Array Float32Array Float64Array BigInt64Array BigUint64Array Atomics Reflect Proxy Intl parseInt parseFloat isNaN isFinite decodeURI decodeURIComponent encodeURI encodeURIComponent eval require module exports __dirname __filename process Buffer global setTimeout clearTimeout setInterval clearInterval setImmediate clearImmediate queueMicrotask structuredClone fetch URL URLSearchParams TextEncoder TextDecoder AbortController AbortSignal WebAssembly GhostNode GhostChannel GhostMesh setEncryptionPolicy __atomis_cell";
const WORDS: &str = "let const var function async await return throw if else for while do switch case default break continue try catch finally new delete void typeof instanceof in of true false null this super class extends implements static public private protected readonly abstract declare export import from as type interface enum namespace keyof infer is asserts satisfies yield debugger with";
fn expanded(source: &str, depth: usize) -> Vec<Token> {
    if depth > 64 {
        return vec![];
    }
    let mut result = vec![];
    for t in tokenize(source) {
        if t.ttype != TokenType::String || !t.value.starts_with(char::from(96)) {
            if !matches!(t.ttype, TokenType::Comment | TokenType::Eof) {
                result.push(t);
            }
            continue;
        }
        let text: Vec<char> = t.value.chars().collect();
        let mut i = 1;
        while i + 1 < text.len() {
            if text[i] == '\\' {
                i += 2;
                continue;
            }
            if text[i] != '$' || text[i + 1] != '{' {
                i += 1;
                continue;
            }
            let start = i + 2;
            let mut balance = 1;
            let mut end = text.len() - 1;
            let tail: String = text[start..].iter().collect();
            for q in tokenize(&tail) {
                if q.value == "{" {
                    balance += 1;
                }
                if q.value == "}" {
                    balance -= 1;
                    if balance == 0 {
                        end = start + q.start;
                        break;
                    }
                }
            }
            let prefix: String = text[..start].iter().collect();
            let lines: Vec<&str> = prefix.split('\n').collect();
            let expression: String = text[start..end].iter().collect();
            for mut q in expanded(&expression, depth + 1) {
                q.start += t.start + start;
                q.end += t.start + start;
                if q.line == 1 {
                    q.col += (if lines.len() == 1 { t.col - 1 } else { 0 })
                        + lines.last().unwrap().chars().count();
                }
                q.line += t.line + lines.len() - 2;
                result.push(q);
            }
            i = end + 1;
        }
    }
    result
}
struct Region {
    lo: usize,
    hi: usize,
    is_fn: bool,
    names: HashMap<String, bool>,
}
struct Function {
    open: usize,
    close: usize,
    scope: usize,
    name: Option<usize>,
    expression: bool,
}
struct Checker {
    tokens: Vec<Token>,
    pairs: HashMap<usize, usize>,
    regions: Vec<Region>,
    ignored: HashSet<usize>,
    declared: HashSet<usize>,
    issues: Vec<(usize, String)>,
}
impl Checker {
    fn v(&self, i: usize) -> &str {
        self.tokens.get(i).map(|t| t.value.as_str()).unwrap_or("")
    }
    fn next(&self, mut i: usize) -> usize {
        while self
            .tokens
            .get(i)
            .is_some_and(|t| t.ttype == TokenType::Newline)
        {
            i += 1;
        }
        i
    }
    fn region(&self, i: usize, function_only: bool) -> usize {
        self.regions
            .iter()
            .enumerate()
            .filter(|(_, s)| s.lo <= i && i <= s.hi && (!function_only || s.is_fn))
            .min_by_key(|(_, s)| s.hi - s.lo)
            .map(|(j, _)| j)
            .unwrap_or(0)
    }
    fn ignore(&mut self, lo: usize, hi: usize) {
        self.ignored.extend(lo..hi);
    }
    fn end_statement(&self, mut i: usize) -> usize {
        if self.v(i) == "{" {
            return self.pairs.get(&i).copied().unwrap_or(i);
        }
        while i < self.tokens.len() {
            if matches!(self.v(i), ";" | "}") || self.tokens[i].ttype == TokenType::Newline {
                return i;
            }
            if let Some(&j) = self.pairs.get(&i) {
                if j > i {
                    i = j;
                }
            }
            i += 1;
        }
        i
    }
    fn arrow_end(&self, start: usize) -> usize {
        if self.v(start) == "{" {
            return self.pairs.get(&start).copied().unwrap_or(start);
        }
        let mut j = start;
        while j < self.tokens.len() {
            if matches!(self.v(j), ";" | "," | ")" | "]" | "}")
                || self.tokens[j].ttype == TokenType::Newline
            {
                return j.saturating_sub(1).max(start);
            }
            if let Some(&k) = self.pairs.get(&j) {
                if k > j {
                    j = k;
                }
            }
            j += 1;
        }
        self.tokens.len()
    }
    fn declare(&mut self, i: usize, s: usize, constant: bool) {
        if i >= self.tokens.len() || !self.declared.insert(i) {
            return;
        }
        let name = self.v(i).to_string();
        if self.regions[s].names.contains_key(&name) {
            self.issues
                .push((i, format!("'{name}' is already declared in this scope")));
        }
        self.regions[s].names.insert(name, constant);
    }
    fn type_end(&self, mut i: usize, end: usize) -> usize {
        let mut angles = 0;
        while i < end {
            let v = self.v(i);
            if v == "<" {
                angles += 1;
            }
            if v == ">" {
                angles -= 1;
            }
            if angles == 0
                && (matches!(
                    v,
                    "=" | ","
                        | ";"
                        | ")"
                        | "in"
                        | "of"
                        | "=>"
                        | "+"
                        | "-"
                        | "*"
                        | "/"
                        | "%"
                        | "&&"
                        | "||"
                        | "??"
                        | "==="
                        | "!=="
                        | "=="
                        | "!="
                        | "}"
                ) || self.tokens[i].ttype == TokenType::Newline)
            {
                break;
            }
            if let Some(&j) = self.pairs.get(&i) {
                if j > i {
                    i = j;
                }
            }
            i += 1;
        }
        i
    }
    fn binding(&mut self, start: usize, end: usize, s: usize, constant: bool) -> usize {
        let mut i = self.next(start);
        if self.v(i) == "..." {
            i += 1;
        }
        if matches!(self.v(i), "{" | "[") {
            let close = self.pairs.get(&i).copied().unwrap_or(i);
            let mut j = i + 1;
            while j < close {
                if matches!(self.v(j), "," | "...") || self.tokens[j].ttype == TokenType::Newline {
                    j += 1;
                    continue;
                }
                if self.v(j + 1) == ":" {
                    self.ignored.insert(j);
                    j += 2;
                }
                let old = j;
                j = self.binding(j, close, s, constant);
                if j <= old {
                    j = old + 1;
                }
                if self.v(j) == "=" {
                    j += 1;
                    while j < close && self.v(j) != "," {
                        if let Some(&k) = self.pairs.get(&j) {
                            if k > j {
                                j = k;
                            }
                        }
                        j += 1;
                    }
                }
                if self.v(j) == "," {
                    j += 1;
                }
            }
            i = close + 1;
        } else {
            self.declare(i, s, constant);
            i += 1;
        }
        if self.v(i) == "?" {
            self.ignored.insert(i);
            i += 1;
        }
        if self.v(i) == ":" {
            let end_type = self.type_end(i + 1, end);
            self.ignore(i, end_type);
            i = end_type;
        }
        i
    }
    fn check(mut self, mappings: &[LineMapping]) -> Vec<Diagnostic> {
        let n = self.tokens.len();
        let mut stack = vec![];
        for i in 0..n {
            if matches!(self.v(i), "(" | "[" | "{") {
                stack.push(i);
            }
            if matches!(self.v(i), ")" | "]" | "}") {
                if let Some(j) = stack.pop() {
                    self.pairs.insert(i, j);
                    self.pairs.insert(j, i);
                }
            }
        }
        self.regions.push(Region {
            lo: 0,
            hi: n,
            is_fn: true,
            names: HashMap::new(),
        });
        for i in 0..n {
            if self.v(i) == "{" {
                if let Some(&hi) = self.pairs.get(&i) {
                    self.regions.push(Region {
                        lo: i,
                        hi,
                        is_fn: false,
                        names: HashMap::new(),
                    });
                }
            }
        }
        for i in 0..n {
            if matches!(self.v(i), "for" | "catch") {
                let mut open = self.next(i + 1);
                if self.v(open) == "await" {
                    open = self.next(open + 1);
                }
                if self.v(open) == "(" {
                    if let Some(&close) = self.pairs.get(&open) {
                        let hi = self.end_statement(self.next(close + 1));
                        self.regions.push(Region {
                            lo: open,
                            hi,
                            is_fn: false,
                            names: HashMap::new(),
                        });
                    }
                }
            }
        }
        let mut functions = vec![];
        for i in 0..n {
            if self.v(i) == "function" {
                let mut j = self.next(i + 1);
                if self.v(j) == "*" {
                    j = self.next(j + 1);
                }
                let name = if self.v(j) == "(" { None } else { Some(j) };
                if name.is_some() {
                    j = self.next(j + 1);
                }
                if self.v(j) != "(" {
                    continue;
                }
                let Some(&close) = self.pairs.get(&j) else {
                    continue;
                };
                let mut body = self.next(close + 1);
                while body < n
                    && !matches!(self.v(body), "{" | ";")
                    && self.tokens[body].ttype != TokenType::Newline
                {
                    if let Some(&k) = self.pairs.get(&body) {
                        if k > body {
                            body = k;
                        }
                    }
                    body += 1;
                }
                let Some(&hi) = self.pairs.get(&body) else {
                    continue;
                };
                let scope = self
                    .regions
                    .iter()
                    .position(|r| r.lo == body && r.hi == hi)
                    .unwrap_or(0);
                self.regions[scope].lo = j;
                self.regions[scope].is_fn = true;
                self.ignore(close + 1, body);
                functions.push(Function {
                    open: j,
                    close,
                    scope,
                    name,
                    expression: i > 0 && matches!(self.v(i - 1), "=" | "(" | ":" | "," | "return"),
                });
            }
            if self.v(i) == "=>" && i > 0 {
                let close = i - 1;
                let parens = self.v(close) == ")";
                let open = if parens {
                    self.pairs.get(&close).copied().unwrap_or(close)
                } else {
                    close
                };
                let body = self.next(i + 1);
                let hi = self.arrow_end(body);
                let scope = if let Some(s) = self
                    .regions
                    .iter()
                    .position(|r| r.lo == body && Some(&r.hi) == self.pairs.get(&body))
                {
                    s
                } else {
                    self.regions.push(Region {
                        lo: open,
                        hi,
                        is_fn: true,
                        names: HashMap::new(),
                    });
                    self.regions.len() - 1
                };
                self.regions[scope].lo = open;
                self.regions[scope].hi = hi;
                self.regions[scope].is_fn = true;
                if !parens {
                    self.declare(open, scope, false);
                }
                functions.push(Function {
                    open,
                    close: if parens { close } else { open },
                    scope,
                    name: None,
                    expression: true,
                });
            }
        }
        // Ordinary method parameters share their method body scope.
        for i in 0..n {
            if !matches!(self.tokens[i].ttype, TokenType::Ident | TokenType::Keyword)
                || (WORDS.split_whitespace().any(|w| w == self.v(i)) && self.v(i) != "constructor")
                || self.v(i + 1) != "("
                || (i > 0 && matches!(self.v(i - 1), "." | "?." | "function"))
            {
                continue;
            }
            let Some(&close) = self.pairs.get(&(i + 1)) else {
                continue;
            };
            if functions.iter().any(|f| f.close == close) {
                continue;
            }
            let mut body = self.next(close + 1);
            if self.v(body) == ":" {
                body += 1;
                while body < n
                    && self.v(body) != "{"
                    && self.tokens[body].ttype != TokenType::Newline
                {
                    if let Some(&k) = self.pairs.get(&body) {
                        if k > body {
                            body = k;
                        }
                    }
                    body += 1;
                }
            }
            if self.v(body) != "{" {
                continue;
            }
            let Some(&hi) = self.pairs.get(&body) else {
                continue;
            };
            let Some(scope) = self.regions.iter().position(|r| r.lo == body && r.hi == hi) else {
                continue;
            };
            self.regions[scope].lo = i + 1;
            self.regions[scope].is_fn = true;
            self.ignored.insert(i);
            self.ignore(close + 1, body);
            functions.push(Function {
                open: i + 1,
                close,
                scope,
                name: None,
                expression: true,
            });
        }
        for f in functions {
            if let Some(name) = f.name {
                let s = if f.expression {
                    f.scope
                } else {
                    self.region(name, false)
                };
                self.declare(name, s, false);
            }
            let mut j = f.open + 1;
            while j < f.close {
                if self.v(j) == "," || self.tokens[j].ttype == TokenType::Newline {
                    j += 1;
                    continue;
                }
                let old = j;
                j = self.binding(j, f.close, f.scope, false);
                if self.v(j) == "=" {
                    j += 1;
                    while j < f.close && self.v(j) != "," {
                        if let Some(&k) = self.pairs.get(&j) {
                            if k > j {
                                j = k;
                            }
                        }
                        j += 1;
                    }
                }
                if j <= old {
                    j += 1;
                }
            }
        }
        for i in 0..n {
            if self.ignored.contains(&i) {
                continue;
            }
            let v = self.v(i).to_string();
            if matches!(v.as_str(), "let" | "const" | "var") {
                let end = self.end_statement(i + 1);
                let s = self.region(i, v == "var");
                let mut j = i + 1;
                while j < end {
                    j = self.binding(j, end, s, v == "const");
                    if self.v(j) == "=" {
                        j += 1;
                        while j < end && !matches!(self.v(j), "," | ";" | "in" | "of") {
                            if let Some(&k) = self.pairs.get(&j) {
                                if k > j {
                                    j = k;
                                }
                            }
                            j += 1;
                        }
                    }
                    if self.v(j) != "," {
                        break;
                    }
                    j += 1;
                }
            }
            if matches!(v.as_str(), "as" | "satisfies") {
                let end = self.type_end(i + 1, n);
                self.ignore(i, end);
            }
            if matches!(self.v(i + 1), ":" | "=") {
                let owner = self.region(i, false);
                let open = self.regions[owner].lo;
                if self.v(open) == "{" {
                    let mut j = open;
                    while j > 0
                        && !matches!(self.v(j - 1), ";" | "{" | "}")
                        && self.tokens[j - 1].ttype != TokenType::Newline
                    {
                        j -= 1;
                    }
                    if (j..open).any(|k| self.v(k) == "class") {
                        self.ignored.insert(i);
                        if self.v(i + 1) == ":" {
                            let end = self.type_end(i + 2, n);
                            self.ignore(i + 1, end);
                        }
                    }
                }
            }
            if v == "catch" && self.v(i + 1) == "(" {
                let end = self.pairs.get(&(i + 1)).copied().unwrap_or(i + 2);
                let s = self.region(i + 1, false);
                self.binding(i + 2, end, s, false);
            }
            if matches!(
                v.as_str(),
                "class" | "enum" | "namespace" | "interface" | "type"
            ) && self
                .tokens
                .get(i + 1)
                .is_some_and(|t| t.ttype == TokenType::Ident)
            {
                let s = self.region(i, false);
                self.declare(i + 1, s, false);
                if matches!(v.as_str(), "interface" | "type") {
                    let end = self.end_statement(i + 2);
                    self.ignore(i + 2, end);
                }
            }
            if v == "import" {
                let mut end = i + 1;
                while end < n
                    && !matches!(
                        self.tokens[end].ttype,
                        TokenType::String | TokenType::Newline
                    )
                {
                    end += 1;
                }
                for j in i + 1..end {
                    if matches!(self.tokens[j].ttype, TokenType::Ident | TokenType::Keyword)
                        && !matches!(self.v(j), "from" | "as" | "type")
                        && self.v(j + 1) != "as"
                    {
                        let s = self.region(i, false);
                        self.declare(j, s, true);
                    }
                }
                self.ignore(i, end + 1);
            }
        }
        let globals: HashSet<&str> = GLOBALS.split_whitespace().collect();
        let words: HashSet<&str> = WORDS.split_whitespace().collect();
        for i in 0..n {
            if self.ignored.contains(&i)
                || self.declared.contains(&i)
                || !matches!(self.tokens[i].ttype, TokenType::Ident | TokenType::Keyword)
                || words.contains(self.v(i))
            {
                continue;
            }
            let prev = if i > 0 { self.v(i - 1) } else { "" }.to_string();
            if matches!(prev.as_str(), "." | "?.") {
                continue;
            }
            let mut previous = i;
            while previous > 0 && self.tokens[previous - 1].ttype == TokenType::Newline {
                previous -= 1;
            }
            let key_previous = if previous > 0 {
                self.v(previous - 1)
            } else {
                ""
            };
            if self.v(i + 1) == ":" && matches!(key_previous, "{" | "," | ";" | "}") {
                continue;
            }
            let owner = self
                .regions
                .iter()
                .filter(|s| s.lo <= i && i <= s.hi && s.names.contains_key(self.v(i)))
                .min_by_key(|s| s.hi - s.lo);
            let constant = owner
                .and_then(|s| s.names.get(self.v(i)))
                .copied()
                .unwrap_or(false);
            if owner.is_none() && !globals.contains(self.v(i)) {
                self.issues
                    .push((i, format!("Undefined identifier '{}'", self.v(i))));
            }
            if constant
                && (matches!(
                    self.v(i + 1),
                    "=" | "+="
                        | "-="
                        | "*="
                        | "/="
                        | "%="
                        | "**="
                        | "&&="
                        | "||="
                        | "??="
                        | "++"
                        | "--"
                ) || matches!(prev.as_str(), "++" | "--"))
            {
                self.issues
                    .push((i, format!("Cannot assign to constant '{}'", self.v(i))));
            }
        }
        self.issues.sort_by_key(|(i, _)| *i);
        self.issues
            .into_iter()
            .map(|(i, message)| Diagnostic {
                message,
                severity: Severity::Error,
                line: mappings
                    .iter()
                    .find(|m| m.generated_line == self.tokens[i].line)
                    .map(|m| m.original_line)
                    .unwrap_or(self.tokens[i].line),
                col: 1,
            })
            .collect()
    }
}
pub fn validate_names(code: &str, mappings: &[LineMapping]) -> Vec<Diagnostic> {
    Checker {
        tokens: expanded(code, 0),
        pairs: HashMap::new(),
        regions: vec![],
        ignored: HashSet::new(),
        declared: HashSet::new(),
        issues: vec![],
    }
    .check(mappings)
}

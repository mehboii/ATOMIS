//! Hand-written recursive-descent parser for Atomis.
//!
//! Faithful port of `src/parser.ts`. Consumes the `Token` stream from the lexer
//! and yields an Atomis `Program`. Anything not recognised as a Layer-2/3
//! construct is collected verbatim as a `TSPassthrough` (Layer 1) by slicing the
//! original source between token offsets.

use crate::ast::*;
use crate::lexer::{Token, TokenType};
use crate::util::json_string;

/// A parse error carrying source coordinates.
#[derive(Debug, Clone)]
pub struct ParseError {
    pub message: String,
    pub line: usize,
    pub col: usize,
}

impl std::fmt::Display for ParseError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "[{}:{}] {}", self.line, self.col, self.message)
    }
}

/// Identifiers that act as boolean/null literals and are NOT quoted.
const LITERAL_WORDS: &[&str] = &["true", "false", "null", "undefined"];

/// Recursive-descent parser for Atomis source.
pub struct Parser {
    tokens: Vec<Token>,
    src: Vec<char>,
    pos: usize,
}

type PResult<T> = Result<T, ParseError>;

impl Parser {
    pub fn new(tokens: Vec<Token>, source: &str) -> Self {
        Parser {
            tokens,
            src: source.chars().collect(),
            pos: 0,
        }
    }

    /// Parse the whole token stream into a program.
    pub fn parse(&mut self) -> PResult<Program> {
        let first = self.peek(0);
        let mut body: Vec<Statement> = Vec::new();
        while !self.at_end() {
            self.skip_blank_lines();
            if self.at_end() {
                break;
            }
            if let Some(stmt) = self.parse_statement()? {
                body.push(stmt);
            }
        }
        Ok(Program {
            line: first.line,
            col: first.col,
            body,
        })
    }

    /* ── cursor helpers ────────────────────────────────────────────────── */

    fn peek(&self, offset: usize) -> Token {
        let i = self.pos + offset;
        self.tokens
            .get(i)
            .cloned()
            .unwrap_or_else(|| self.tokens[self.tokens.len() - 1].clone())
    }

    fn next(&mut self) -> Token {
        let t = self.tokens[self.pos].clone();
        if self.pos < self.tokens.len() - 1 {
            self.pos += 1;
        }
        t
    }

    fn at_end(&self) -> bool {
        self.peek(0).ttype == TokenType::Eof
    }

    fn check(&self, ttype: TokenType, value: Option<&str>) -> bool {
        let t = self.peek(0);
        if t.ttype != ttype {
            return false;
        }
        match value {
            None => true,
            Some(v) => t.value == v,
        }
    }

    fn expect(&mut self, ttype: TokenType, value: Option<&str>) -> PResult<Token> {
        if !self.check(ttype, value) {
            let t = self.peek(0);
            let want = match value {
                Some(v) => format!("{:?} '{}'", ttype, v),
                None => format!("{:?}", ttype),
            };
            return Err(ParseError {
                message: format!(
                    "Expected {} but found {:?} '{}'",
                    want, t.ttype, t.value
                ),
                line: t.line,
                col: t.col,
            });
        }
        Ok(self.next())
    }

    /// Skip NEWLINE and COMMENT tokens.
    fn skip_newlines(&mut self) {
        while self.check(TokenType::Newline, None) || self.check(TokenType::Comment, None) {
            self.next();
        }
    }

    /// Skip only NEWLINE tokens, leaving COMMENTs to be preserved as passthrough.
    fn skip_blank_lines(&mut self) {
        while self.check(TokenType::Newline, None) {
            self.next();
        }
    }

    /* ── statement dispatch ────────────────────────────────────────────── */

    fn parse_statement(&mut self) -> PResult<Option<Statement>> {
        self.skip_blank_lines();
        if self.at_end() {
            return Ok(None);
        }

        let t = self.peek(0);

        // Preserve a standalone comment as a passthrough chunk.
        if t.ttype == TokenType::Comment {
            self.next();
            return Ok(Some(Statement::TSPassthrough(TSPassthrough {
                line: t.line,
                col: t.col,
                raw: t.value,
            })));
        }

        // Decorators.
        if t.ttype == TokenType::Decorator {
            return Ok(Some(self.parse_decorator()?));
        }

        // `async fn` / `async pure fn`.
        if t.ttype == TokenType::Ident
            && t.value == "async"
            && (self.peek(1).value == "fn" || self.peek(1).value == "pure")
        {
            self.next(); // consume 'async'
            return Ok(Some(self.parse_fn_like(true)?));
        }

        if t.ttype == TokenType::Keyword {
            let n1 = self.peek(1);
            let n2 = self.peek(2);
            match t.value.as_str() {
                "atom" => {
                    if n1.ttype == TokenType::Ident {
                        return Ok(Some(self.parse_atom()?));
                    }
                }
                "fn" | "pure" => {
                    return Ok(Some(self.parse_fn_like(false)?));
                }
                "node" => {
                    if n1.ttype == TokenType::String
                        || ((n1.ttype == TokenType::Ident || n1.ttype == TokenType::Keyword)
                            && n2.ttype == TokenType::String)
                    {
                        return Ok(Some(self.parse_node()?));
                    }
                }
                "channel" => {
                    if n1.ttype == TokenType::String {
                        return Ok(Some(self.parse_channel()?));
                    }
                }
                "mesh" => {
                    if n1.ttype == TokenType::String {
                        return Ok(Some(self.parse_mesh()?));
                    }
                }
                "connect" => {
                    if n1.ttype == TokenType::String {
                        return Ok(Some(self.parse_connect()?));
                    }
                }
                "encrypt" => {
                    if n1.ttype == TokenType::LBrace {
                        return Ok(Some(self.parse_encrypt()?));
                    }
                }
                "guard" => {
                    if !(n1.value == "." || n1.value == "(" || n1.value == "=") {
                        return Ok(Some(self.parse_guard()?));
                    }
                }
                "match" => {
                    if !(n1.value == "." || n1.value == "(" || n1.value == "=") {
                        return Ok(Some(self.parse_match()?));
                    }
                }
                "output" => {
                    if n1.value == "(" {
                        return Ok(Some(self.parse_output()?));
                    }
                }
                _ => {}
            }
        }

        // Everything else: raw TypeScript passthrough.
        Ok(Some(Statement::TSPassthrough(self.parse_raw_statement())))
    }

    /* ── Layer 1: passthrough ──────────────────────────────────────────── */

    fn parse_raw_statement(&mut self) -> TSPassthrough {
        let start = self.peek(0);
        let start_offset = start.start;
        let mut end_offset = start.end;
        let mut depth: i64 = 0;

        while !self.at_end() {
            let tk = self.peek(0);

            if tk.ttype == TokenType::Newline {
                if depth == 0 && !self.continues(end_offset) {
                    self.next();
                    break;
                }
                self.next();
                continue;
            }
            if tk.ttype == TokenType::Comment {
                self.next();
                continue;
            }

            if is_open(&tk) {
                depth += 1;
            } else if is_close(&tk) {
                if depth == 0 && tk.ttype == TokenType::RBrace {
                    // Closes an enclosing block — do not consume.
                    break;
                }
                depth -= 1;
            }

            end_offset = tk.end;
            self.next();

            if depth == 0 && tk.ttype == TokenType::Punctuation && tk.value == ";" {
                break;
            }
        }

        TSPassthrough {
            line: start.line,
            col: start.col,
            raw: self.slice(start_offset, end_offset),
        }
    }

    /// Decide whether a statement continues onto the next line by inspecting the
    /// last consumed source character.
    fn continues(&self, end_offset: usize) -> bool {
        let text: String = self.src[0..end_offset.min(self.src.len())].iter().collect();
        let trimmed = text.trim_end();
        match trimmed.chars().last() {
            Some(last) => "+-*/%=<>&|^,.([{?:".contains(last),
            None => false,
        }
    }

    /* ── generic raw collectors ────────────────────────────────────────── */

    /// Collect source text until `stop` returns true at bracket depth 0 (the
    /// stopping token is NOT consumed). Returns the trimmed verbatim slice.
    fn raw_until<F>(&mut self, stop: F, angles: bool) -> String
    where
        F: Fn(&Token) -> bool,
    {
        let mut start_offset: Option<usize> = None;
        let mut end_offset: usize = 0;
        let mut depth: i64 = 0;
        while !self.at_end() {
            let tk = self.peek(0);
            if depth == 0 && stop(&tk) {
                break;
            }
            if tk.ttype == TokenType::Newline || tk.ttype == TokenType::Comment {
                self.next();
                continue;
            }
            if is_open(&tk) {
                depth += 1;
            } else if is_close(&tk) {
                depth -= 1;
            } else if angles {
                depth += angle_delta(&tk);
            }
            if depth < 0 {
                depth = 0;
            }
            if start_offset.is_none() {
                start_offset = Some(tk.start);
            }
            end_offset = tk.end;
            self.next();
        }
        match start_offset {
            None => String::new(),
            Some(s) => self.slice(s, end_offset).trim().to_string(),
        }
    }

    /* ── Layer 2: atom ─────────────────────────────────────────────────── */

    fn parse_atom(&mut self) -> PResult<Statement> {
        let kw = self.expect(TokenType::Keyword, Some("atom"))?;
        let name = self.expect(TokenType::Ident, None)?.value;

        let mut type_annotation: Option<String> = None;
        if self.check(TokenType::Punctuation, Some(":")) {
            self.next();
            let ta = self.raw_until(
                |t| {
                    (t.ttype == TokenType::Operator && t.value == "=")
                        || t.ttype == TokenType::Newline
                },
                true,
            );
            type_annotation = non_empty(ta);
        }

        let mut initializer: Option<String> = None;
        if self.check(TokenType::Operator, Some("=")) {
            self.next();
            let init = self.raw_until(
                |t| {
                    t.ttype == TokenType::Newline
                        || (t.ttype == TokenType::Punctuation && t.value == ";")
                },
                false,
            );
            initializer = non_empty(init);
        }
        if self.check(TokenType::Punctuation, Some(";")) {
            self.next();
        }

        Ok(Statement::AtomDecl(AtomDecl {
            line: kw.line,
            col: kw.col,
            name,
            type_annotation,
            initializer,
        }))
    }

    /* ── Layer 2: fn / pure fn ─────────────────────────────────────────── */

    fn parse_fn_like(&mut self, is_async: bool) -> PResult<Statement> {
        let mut is_pure = false;
        let start = self.peek(0);
        if self.check(TokenType::Keyword, Some("pure")) {
            self.next();
            is_pure = true;
        }
        self.expect(TokenType::Keyword, Some("fn"))?;
        let name = self.expect(TokenType::Ident, None)?.value;
        let params = self.parse_params()?;

        let mut return_type: Option<String> = None;
        if self.check(TokenType::Arrow, None) {
            self.next();
            let rt = self.raw_until(|t| t.ttype == TokenType::LBrace, true);
            return_type = non_empty(rt);
        }

        let body = self.parse_brace_body()?;

        let data = FnDeclData {
            line: start.line,
            col: start.col,
            name,
            is_async,
            params,
            return_type,
            body,
        };
        if is_pure {
            Ok(Statement::PureFnDecl(data))
        } else {
            Ok(Statement::FnDecl(data))
        }
    }

    fn parse_params(&mut self) -> PResult<Vec<Param>> {
        self.expect(TokenType::Punctuation, Some("("))?;
        let mut params: Vec<Param> = Vec::new();
        self.skip_newlines();
        while !self.check(TokenType::Punctuation, Some(")")) && !self.at_end() {
            let name_tok = self.peek(0);
            let name = self.next().value;

            let mut type_annotation: Option<String> = None;
            if self.check(TokenType::Punctuation, Some(":")) {
                self.next();
                let ta = self.raw_until(
                    |t| {
                        (t.ttype == TokenType::Punctuation
                            && (t.value == "," || t.value == ")"))
                            || (t.ttype == TokenType::Operator && t.value == "=")
                    },
                    true,
                );
                type_annotation = non_empty(ta);
            }

            let mut default_value: Option<String> = None;
            if self.check(TokenType::Operator, Some("=")) {
                self.next();
                let dv = self.raw_until(
                    |t| {
                        t.ttype == TokenType::Punctuation
                            && (t.value == "," || t.value == ")")
                    },
                    false,
                );
                default_value = non_empty(dv);
            }

            params.push(Param {
                line: name_tok.line,
                col: name_tok.col,
                name,
                type_annotation,
                default_value,
            });

            self.skip_newlines();
            if self.check(TokenType::Punctuation, Some(",")) {
                self.next();
                self.skip_newlines();
            }
        }
        self.expect(TokenType::Punctuation, Some(")"))?;
        Ok(params)
    }

    fn parse_brace_body(&mut self) -> PResult<Vec<Statement>> {
        self.expect(TokenType::LBrace, None)?;
        let mut body: Vec<Statement> = Vec::new();
        self.skip_blank_lines();
        while !self.check(TokenType::RBrace, None) && !self.at_end() {
            if let Some(stmt) = self.parse_statement()? {
                body.push(stmt);
            }
            self.skip_blank_lines();
        }
        self.expect(TokenType::RBrace, None)?;
        Ok(body)
    }

    /* ── Layer 2: guard ────────────────────────────────────────────────── */

    fn parse_guard(&mut self) -> PResult<Statement> {
        let kw = self.expect(TokenType::Keyword, Some("guard"))?;
        let condition =
            self.raw_until(|t| t.ttype == TokenType::Keyword && t.value == "else", false);
        self.expect(TokenType::Keyword, Some("else"))?;
        let else_body = self.parse_brace_body()?;
        Ok(Statement::GuardStmt(GuardStmt {
            line: kw.line,
            col: kw.col,
            condition,
            else_body,
        }))
    }

    /* ── Layer 2: match ────────────────────────────────────────────────── */

    fn parse_match(&mut self) -> PResult<Statement> {
        let kw = self.expect(TokenType::Keyword, Some("match"))?;
        let discriminant = self.raw_until(|t| t.ttype == TokenType::LBrace, false);
        self.expect(TokenType::LBrace, None)?;
        let mut arms: Vec<MatchArm> = Vec::new();
        self.skip_newlines();
        while !self.check(TokenType::RBrace, None) && !self.at_end() {
            let arm_start = self.peek(0);
            let pattern =
                self.raw_until(|t| t.ttype == TokenType::Operator && t.value == "=>", false);
            self.expect(TokenType::Operator, Some("=>"))?;
            let result = self.raw_until(
                |t| {
                    (t.ttype == TokenType::Punctuation && t.value == ",")
                        || t.ttype == TokenType::RBrace
                        || t.ttype == TokenType::Newline
                },
                false,
            );
            arms.push(MatchArm {
                line: arm_start.line,
                col: arm_start.col,
                is_wildcard: pattern.trim() == "_",
                pattern,
                result,
            });
            self.skip_newlines();
            if self.check(TokenType::Punctuation, Some(",")) {
                self.next();
                self.skip_newlines();
            }
        }
        self.expect(TokenType::RBrace, None)?;
        Ok(Statement::MatchExpr(MatchExpr {
            line: kw.line,
            col: kw.col,
            discriminant,
            arms,
        }))
    }

    /* ── Layer 2: output ───────────────────────────────────────────────── */

    fn parse_output(&mut self) -> PResult<Statement> {
        let kw = self.expect(TokenType::Keyword, Some("output"))?;
        self.expect(TokenType::Punctuation, Some("("))?;
        let argument =
            self.raw_until(|t| t.ttype == TokenType::Punctuation && t.value == ")", false);
        self.expect(TokenType::Punctuation, Some(")"))?;
        if self.check(TokenType::Punctuation, Some(";")) {
            self.next();
        }
        Ok(Statement::OutputCall(OutputCall {
            line: kw.line,
            col: kw.col,
            argument,
        }))
    }

    /* ── Decorators ────────────────────────────────────────────────────── */

    fn parse_decorator(&mut self) -> PResult<Statement> {
        let dec = self.peek(0);
        match dec.value.as_str() {
            "@cell" => self.parse_cell(),
            "@render" => self.parse_render(),
            "@import" => self.parse_import(),
            "@meta" => self.parse_meta(),
            // Unknown decorator → treat as passthrough so we stay resilient.
            _ => Ok(Statement::TSPassthrough(self.parse_raw_statement())),
        }
    }

    fn parse_cell(&mut self) -> PResult<Statement> {
        let dec = self.expect(TokenType::Decorator, Some("@cell"))?;
        if self.check(TokenType::Punctuation, Some("[")) {
            self.next();
        }
        if self.check(TokenType::Punctuation, Some("#")) {
            self.next();
        }
        let name = if self.check(TokenType::Ident, None) {
            self.next().value
        } else {
            "cell".to_string()
        };
        if self.check(TokenType::Punctuation, Some("]")) {
            self.next();
        }

        let body: Vec<Statement>;
        if self.peek_skipping_newlines().ttype == TokenType::LBrace {
            self.skip_newlines();
            body = self.parse_brace_body()?;
        } else {
            body = self.parse_inline_block()?;
        }

        let is_async = body.iter().any(statement_uses_await);
        Ok(Statement::CellBlock(CellBlock {
            line: dec.line,
            col: dec.col,
            name,
            is_async,
            body,
        }))
    }

    fn peek_skipping_newlines(&self) -> Token {
        let mut i = self.pos;
        while i < self.tokens.len()
            && (self.tokens[i].ttype == TokenType::Newline
                || self.tokens[i].ttype == TokenType::Comment)
        {
            i += 1;
        }
        self.tokens
            .get(i)
            .cloned()
            .unwrap_or_else(|| self.tokens[self.tokens.len() - 1].clone())
    }

    fn parse_inline_block(&mut self) -> PResult<Vec<Statement>> {
        let mut body: Vec<Statement> = Vec::new();
        if self.check(TokenType::Newline, None) {
            self.next();
        }

        while !self.at_end() {
            let mut newline_count = 0;
            while self.check(TokenType::Newline, None) || self.check(TokenType::Comment, None) {
                if self.check(TokenType::Newline, None) {
                    newline_count += 1;
                }
                self.next();
            }
            if newline_count >= 2 {
                break;
            }
            if self.at_end() {
                break;
            }

            let t = self.peek(0);
            if t.ttype == TokenType::Decorator {
                break;
            }
            if t.ttype == TokenType::Keyword
                && matches!(
                    t.value.as_str(),
                    "fn" | "pure" | "node" | "channel" | "mesh" | "connect" | "encrypt" | "atom"
                )
            {
                break;
            }
            if t.ttype == TokenType::RBrace {
                break;
            }

            if let Some(stmt) = self.parse_statement()? {
                body.push(stmt);
            }
        }
        Ok(body)
    }

    fn parse_render(&mut self) -> PResult<Statement> {
        let dec = self.expect(TokenType::Decorator, Some("@render"))?;
        self.skip_newlines();
        self.expect(TokenType::LBrace, None)?;
        let mut views: Vec<ViewDecl> = Vec::new();
        self.skip_newlines();
        while !self.check(TokenType::RBrace, None) && !self.at_end() {
            if self.check(TokenType::Keyword, Some("view")) {
                views.push(self.parse_view()?);
            } else {
                self.next();
            }
            self.skip_newlines();
        }
        self.expect(TokenType::RBrace, None)?;
        Ok(Statement::RenderBlock(RenderBlock {
            line: dec.line,
            col: dec.col,
            views,
        }))
    }

    fn parse_view(&mut self) -> PResult<ViewDecl> {
        let kw = self.expect(TokenType::Keyword, Some("view"))?;
        let name = self.expect(TokenType::Ident, None)?.value;
        let open = self.expect(TokenType::LBrace, None)?;
        let mut depth = 1;
        let start_offset = open.end;
        let mut end_offset = open.end;
        while !self.at_end() && depth > 0 {
            let tk = self.peek(0);
            if tk.ttype == TokenType::LBrace {
                depth += 1;
            } else if tk.ttype == TokenType::RBrace {
                depth -= 1;
                if depth == 0 {
                    break;
                }
            }
            end_offset = tk.end;
            self.next();
        }
        self.expect(TokenType::RBrace, None)?;
        Ok(ViewDecl {
            line: kw.line,
            col: kw.col,
            name,
            jsx: self.slice(start_offset, end_offset).trim().to_string(),
        })
    }

    fn parse_import(&mut self) -> PResult<Statement> {
        let dec = self.expect(TokenType::Decorator, Some("@import"))?;
        self.expect(TokenType::LBrace, None)?;
        let mut names: Vec<String> = Vec::new();
        self.skip_newlines();
        while !self.check(TokenType::RBrace, None) && !self.at_end() {
            if self.check(TokenType::Ident, None) || self.check(TokenType::Keyword, None) {
                names.push(self.next().value);
            } else {
                self.next();
            }
            self.skip_newlines();
            if self.check(TokenType::Punctuation, Some(",")) {
                self.next();
                self.skip_newlines();
            }
        }
        self.expect(TokenType::RBrace, None)?;
        if self.check(TokenType::Ident, Some("from")) {
            self.next();
        }
        let module_tok = self.expect(TokenType::String, None)?;
        Ok(Statement::ImportDecl(ImportDecl {
            line: dec.line,
            col: dec.col,
            names,
            module: unquote(&module_tok.value),
        }))
    }

    fn parse_meta(&mut self) -> PResult<Statement> {
        let dec = self.expect(TokenType::Decorator, Some("@meta"))?;
        let entries = self.parse_config_block()?;
        Ok(Statement::MetaBlock(MetaBlock {
            line: dec.line,
            col: dec.col,
            entries,
        }))
    }

    /* ── Layer 3: GhostNet ─────────────────────────────────────────────── */

    fn parse_node(&mut self) -> PResult<Statement> {
        let kw = self.expect(TokenType::Keyword, Some("node"))?;
        let mut kind: Option<String> = None;
        if self.check(TokenType::Ident, None) || self.check(TokenType::Keyword, None) {
            kind = Some(self.next().value);
        }
        let id = unquote(&self.expect(TokenType::String, None)?.value);
        let config = self.parse_config_block()?;
        Ok(Statement::NodeDecl(NodeDecl {
            line: kw.line,
            col: kw.col,
            kind,
            id,
            config,
        }))
    }

    fn parse_channel(&mut self) -> PResult<Statement> {
        let kw = self.expect(TokenType::Keyword, Some("channel"))?;
        let id = unquote(&self.expect(TokenType::String, None)?.value);
        let config = self.parse_config_block()?;
        Ok(Statement::ChannelDecl(ChannelDecl {
            line: kw.line,
            col: kw.col,
            id,
            config,
        }))
    }

    fn parse_mesh(&mut self) -> PResult<Statement> {
        let kw = self.expect(TokenType::Keyword, Some("mesh"))?;
        let id = unquote(&self.expect(TokenType::String, None)?.value);
        let config = self.parse_config_block()?;
        Ok(Statement::MeshDecl(MeshDecl {
            line: kw.line,
            col: kw.col,
            id,
            config,
        }))
    }

    fn parse_connect(&mut self) -> PResult<Statement> {
        let kw = self.expect(TokenType::Keyword, Some("connect"))?;
        let channel = unquote(&self.expect(TokenType::String, None)?.value);
        self.expect(TokenType::Arrow, None)?;
        let node = unquote(&self.expect(TokenType::String, None)?.value);
        self.expect(TokenType::Keyword, Some("via"))?;
        let transport_tok = self.peek(0);
        let transport = self.next().value;
        if self.check(TokenType::Punctuation, Some(";")) {
            self.next();
        }
        let unq = unquote(&transport);
        let transport_final = if unq.is_empty() {
            transport_tok.value
        } else {
            unq
        };
        Ok(Statement::ConnectStmt(ConnectStmt {
            line: kw.line,
            col: kw.col,
            channel,
            node,
            transport: transport_final,
        }))
    }

    fn parse_encrypt(&mut self) -> PResult<Statement> {
        let kw = self.expect(TokenType::Keyword, Some("encrypt"))?;
        let config = self.parse_config_block()?;
        Ok(Statement::EncryptDecl(EncryptDecl {
            line: kw.line,
            col: kw.col,
            config,
        }))
    }

    /* ── config blocks ─────────────────────────────────────────────────── */

    fn parse_config_block(&mut self) -> PResult<Vec<ConfigEntry>> {
        self.expect(TokenType::LBrace, None)?;
        let mut entries: Vec<ConfigEntry> = Vec::new();
        self.skip_newlines();
        while !self.check(TokenType::RBrace, None) && !self.at_end() {
            let key_tok = self.peek(0);
            let key = self.next().value;
            self.expect(TokenType::Punctuation, Some(":"))?;
            let value = self.parse_config_value();
            entries.push(ConfigEntry {
                line: key_tok.line,
                col: key_tok.col,
                key,
                value,
            });
            self.skip_newlines();
            if self.check(TokenType::Punctuation, Some(",")) {
                self.next();
                self.skip_newlines();
            }
        }
        self.expect(TokenType::RBrace, None)?;
        Ok(entries)
    }

    fn parse_config_value(&mut self) -> String {
        let mut value_tokens: Vec<Token> = Vec::new();
        let mut depth: i64 = 0;
        while !self.at_end() {
            let tk = self.peek(0);
            if depth == 0
                && (tk.ttype == TokenType::Newline
                    || tk.ttype == TokenType::RBrace
                    || (tk.ttype == TokenType::Punctuation && tk.value == ","))
            {
                break;
            }
            if tk.ttype == TokenType::Comment {
                self.next();
                continue;
            }
            if is_open(&tk) {
                depth += 1;
            } else if is_close(&tk) {
                depth -= 1;
            }
            value_tokens.push(tk);
            self.next();
        }
        render_config_value(&value_tokens)
    }

    /* ── small utilities ───────────────────────────────────────────────── */

    fn slice(&self, start: usize, end: usize) -> String {
        let end = end.min(self.src.len());
        if start >= end {
            return String::new();
        }
        self.src[start..end].iter().collect()
    }
}

/* ── module-level helpers (mirroring private TS methods) ─────────────────── */

fn is_open(t: &Token) -> bool {
    t.ttype == TokenType::LBrace
        || (t.ttype == TokenType::Punctuation && (t.value == "(" || t.value == "["))
}

fn is_close(t: &Token) -> bool {
    t.ttype == TokenType::RBrace
        || (t.ttype == TokenType::Punctuation && (t.value == ")" || t.value == "]"))
}

fn angle_delta(t: &Token) -> i64 {
    if t.ttype != TokenType::Operator {
        return 0;
    }
    match t.value.as_str() {
        "<" => 1,
        "<<" => 2,
        ">" => -1,
        ">>" => -2,
        ">>>" => -3,
        _ => 0,
    }
}

/// `text || undefined`: empty string becomes `None`.
fn non_empty(s: String) -> Option<String> {
    if s.is_empty() {
        None
    } else {
        Some(s)
    }
}

/// Strip surrounding single/double quotes (and backticks) from a literal.
fn unquote(s: &str) -> String {
    let chars: Vec<char> = s.chars().collect();
    if chars.len() >= 2 {
        let q = chars[0];
        if (q == '"' || q == '\'' || q == '`') && chars[chars.len() - 1] == q {
            return chars[1..chars.len() - 1].iter().collect();
        }
    }
    s.to_string()
}

/// Heuristically determine whether a statement contains `await`.
pub fn statement_uses_await(s: &Statement) -> bool {
    match s {
        Statement::TSPassthrough(p) => contains_word(&p.raw, "await"),
        Statement::OutputCall(o) => contains_word(&o.argument, "await"),
        _ => false,
    }
}

/// JS `\bWORD\b` test. Word characters are `[A-Za-z0-9_]` (note: not `$`).
pub fn contains_word(text: &str, word: &str) -> bool {
    let chars: Vec<char> = text.chars().collect();
    let w: Vec<char> = word.chars().collect();
    if w.is_empty() {
        return false;
    }
    let is_word = |c: char| c.is_ascii_alphanumeric() || c == '_';
    let mut i = 0;
    while i + w.len() <= chars.len() {
        if chars[i..i + w.len()] == w[..] {
            let before_ok = i == 0 || !is_word(chars[i - 1]);
            let after_idx = i + w.len();
            let after_ok = after_idx >= chars.len() || !is_word(chars[after_idx]);
            if before_ok && after_ok {
                return true;
            }
        }
        i += 1;
    }
    false
}

/// Join normalized value tokens into a TS expression string with sensible
/// spacing, quoting bare identifiers. Mirrors `renderConfigValue`.
fn render_config_value(tokens: &[Token]) -> String {
    let mut parts: Vec<String> = Vec::new();
    let mut prev = String::new();
    for tk in tokens {
        let mut text = tk.value.clone();
        if (tk.ttype == TokenType::Ident || tk.ttype == TokenType::Keyword)
            && !LITERAL_WORDS.contains(&tk.value.as_str())
        {
            text = json_string(&tk.value);
        }
        let no_space = parts.is_empty()
            || text == ","
            || text == "]"
            || text == ")"
            || text == "."
            || prev == "["
            || prev == "("
            || prev == ".";
        parts.push(if no_space {
            text
        } else {
            format!(" {}", text)
        });
        prev = tk.value.clone();
    }
    parts.join("").trim().to_string()
}

/// Convenience wrapper: parse a token stream into a program.
pub fn parse(tokens: Vec<Token>, source: &str) -> PResult<Program> {
    Parser::new(tokens, source).parse()
}

/// Port of `src/tests/parser.test.ts` (15 cases).
#[cfg(test)]
mod tests {
    use super::*;
    use crate::lexer::tokenize;

    fn p(src: &str) -> Program {
        parse(tokenize(src), src).expect("parse failed")
    }

    #[test]
    fn parses_atom_with_type_and_initializer() {
        let ast = p("atom activeNodes: Node[] = []");
        match &ast.body[0] {
            Statement::AtomDecl(a) => {
                assert_eq!(a.name, "activeNodes");
                assert_eq!(a.type_annotation.as_deref(), Some("Node[]"));
                assert_eq!(a.initializer.as_deref(), Some("[]"));
            }
            other => panic!("expected AtomDecl, got {:?}", other),
        }
    }

    #[test]
    fn parses_fn_with_params_and_return_type() {
        let ast = p("fn sendMsg(text: string) -> void { return }");
        match &ast.body[0] {
            Statement::FnDecl(f) => {
                assert_eq!(f.name, "sendMsg");
                assert_eq!(f.params.len(), 1);
                assert_eq!(f.params[0].name, "text");
                assert_eq!(f.params[0].type_annotation.as_deref(), Some("string"));
                assert_eq!(f.return_type.as_deref(), Some("void"));
            }
            other => panic!("expected FnDecl, got {:?}", other),
        }
    }

    #[test]
    fn parses_pure_fn() {
        let ast = p("pure fn add(a: number, b: number) -> number { return a + b }");
        assert!(matches!(ast.body[0], Statement::PureFnDecl(_)));
    }

    #[test]
    fn parses_guard_statement() {
        let ast = p("fn f() -> void { guard text.length > 0 else { return } }");
        match &ast.body[0] {
            Statement::FnDecl(f) => match &f.body[0] {
                Statement::GuardStmt(g) => {
                    assert_eq!(g.condition, "text.length > 0");
                    assert_eq!(g.else_body.len(), 1);
                }
                other => panic!("expected GuardStmt, got {:?}", other),
            },
            other => panic!("expected FnDecl, got {:?}", other),
        }
    }

    #[test]
    fn parses_match_with_wildcard() {
        let ast = p("match x { 1 => a, 2 => b, _ => c }");
        match &ast.body[0] {
            Statement::MatchExpr(m) => {
                assert_eq!(m.discriminant, "x");
                assert_eq!(m.arms.len(), 3);
                assert!(m.arms[2].is_wildcard);
            }
            other => panic!("expected MatchExpr, got {:?}", other),
        }
    }

    #[test]
    fn parses_node_with_kind_id_config() {
        let ast = p(r#"node relay "node-01" { type: esp32, transport: [bluetooth, tcp] }"#);
        match &ast.body[0] {
            Statement::NodeDecl(n) => {
                assert_eq!(n.kind.as_deref(), Some("relay"));
                assert_eq!(n.id, "node-01");
                assert_eq!(n.config[0].key, "type");
                assert_eq!(n.config[0].value, r#""esp32""#);
                assert_eq!(n.config[1].value, r#"["bluetooth", "tcp"]"#);
            }
            other => panic!("expected NodeDecl, got {:?}", other),
        }
    }

    #[test]
    fn parses_channel_preserving_booleans() {
        let ast = p(r#"channel "ghostchat" { e2e: true, persist: false }"#);
        match &ast.body[0] {
            Statement::ChannelDecl(ch) => {
                assert_eq!(ch.id, "ghostchat");
                assert_eq!(ch.config[0].value, "true");
                assert_eq!(ch.config[1].value, "false");
            }
            other => panic!("expected ChannelDecl, got {:?}", other),
        }
    }

    #[test]
    fn parses_mesh() {
        let ast = p(r#"mesh "m1" { region: us }"#);
        match &ast.body[0] {
            Statement::MeshDecl(m) => assert_eq!(m.id, "m1"),
            other => panic!("expected MeshDecl, got {:?}", other),
        }
    }

    #[test]
    fn parses_connect() {
        let ast = p(r#"connect "ghostchat" -> "node-01" via bluetooth"#);
        match &ast.body[0] {
            Statement::ConnectStmt(c) => {
                assert_eq!(c.channel, "ghostchat");
                assert_eq!(c.node, "node-01");
                assert_eq!(c.transport, "bluetooth");
            }
            other => panic!("expected ConnectStmt, got {:?}", other),
        }
    }

    #[test]
    fn parses_encrypt() {
        let ast = p(r#"encrypt { algorithm: aes256, forward_secrecy: true }"#);
        match &ast.body[0] {
            Statement::EncryptDecl(e) => {
                assert_eq!(e.config[0].key, "algorithm");
                assert_eq!(e.config[1].value, "true");
            }
            other => panic!("expected EncryptDecl, got {:?}", other),
        }
    }

    #[test]
    fn parses_import_decorator() {
        let ast = p(r#"@import { mesh, GhostChannel } from "ghostnet/core""#);
        match &ast.body[0] {
            Statement::ImportDecl(i) => {
                assert_eq!(i.names, vec!["mesh", "GhostChannel"]);
                assert_eq!(i.module, "ghostnet/core");
            }
            other => panic!("expected ImportDecl, got {:?}", other),
        }
    }

    #[test]
    fn parses_inline_cell_until_blank_line() {
        let ast = p("@cell #scan\nx = await scan()\noutput(`done`)\n\nfn after() -> void {}");
        match &ast.body[0] {
            Statement::CellBlock(c) => {
                assert_eq!(c.name, "scan");
                assert!(c.is_async);
                assert_eq!(c.body.len(), 2);
            }
            other => panic!("expected CellBlock, got {:?}", other),
        }
        assert!(matches!(ast.body[1], Statement::FnDecl(_)));
    }

    #[test]
    fn treats_unknown_typescript_as_passthrough() {
        let ast = p(r#"const greeting: string = "hi";"#);
        assert!(matches!(ast.body[0], Statement::TSPassthrough(_)));
    }

    #[test]
    fn does_not_treat_channel_send_as_channel_decl() {
        let ast = p(r#"channel.send("ghostchat", text)"#);
        assert!(matches!(ast.body[0], Statement::TSPassthrough(_)));
    }

    #[test]
    fn parses_output_as_output_call() {
        let ast = p("output(`Found ${n} peers`)");
        match &ast.body[0] {
            Statement::OutputCall(o) => assert_eq!(o.argument, "`Found ${n} peers`"),
            other => panic!("expected OutputCall, got {:?}", other),
        }
    }
}

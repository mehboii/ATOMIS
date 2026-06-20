//! Transforms an Atomis `Program` AST into TypeScript source text.
//!
//! Faithful port of `src/transformer.ts`. Emits clean, canonically-formatted
//! TypeScript text together with a line-level mapping back to the original
//! `.ato` source. (The source map is currently consumed only as a hook — see
//! `emitter.rs`.)

use crate::ast::*;
use crate::util::json_string;

/// A single generated line mapped back to its originating source line.
#[derive(Debug, Clone)]
pub struct LineMapping {
    pub generated_line: usize,
    pub original_line: usize,
}

/// The result of transforming a program.
#[derive(Debug, Clone)]
pub struct TransformResult {
    pub code: String,
    pub mappings: Vec<LineMapping>,
    pub atoms: Vec<String>,
}

/// Indentation unit (two spaces).
const INDENT: &str = "  ";

pub struct Transformer {
    lines: Vec<String>,
    mappings: Vec<LineMapping>,
    atoms: Vec<String>,
}

impl Transformer {
    pub fn new() -> Self {
        Transformer {
            lines: Vec::new(),
            mappings: Vec::new(),
            atoms: Vec::new(),
        }
    }

    pub fn transform(mut self, program: &Program) -> TransformResult {
        for stmt in &program.body {
            self.emit_statement(stmt, 0);
        }
        let mut code = self.lines.join("\n");
        if !self.lines.is_empty() {
            code.push('\n');
        }
        TransformResult {
            code,
            mappings: self.mappings,
            atoms: self.atoms,
        }
    }

    /* ── emission primitives ───────────────────────────────────────────── */

    fn emit(&mut self, text: &str, indent: usize, src_line: usize) {
        let content = if !text.is_empty() {
            format!("{}{}", INDENT.repeat(indent), text)
        } else {
            String::new()
        };
        self.lines.push(content);
        self.mappings.push(LineMapping {
            generated_line: self.lines.len(),
            original_line: src_line,
        });
    }

    /* ── statement dispatch ────────────────────────────────────────────── */

    fn emit_statement(&mut self, stmt: &Statement, indent: usize) {
        match stmt {
            Statement::TSPassthrough(s) => self.emit_passthrough(s, indent),
            Statement::AtomDecl(s) => self.emit_atom(s, indent),
            Statement::FnDecl(s) => self.emit_fn(s, indent, false),
            Statement::PureFnDecl(s) => self.emit_fn(s, indent, true),
            Statement::GuardStmt(s) => self.emit_guard(s, indent),
            Statement::MatchExpr(s) => self.emit_match(s, indent),
            Statement::OutputCall(s) => self.emit_output(s, indent),
            Statement::ImportDecl(s) => self.emit_import(s, indent),
            Statement::MetaBlock(s) => self.emit_meta(s, indent),
            Statement::CellBlock(s) => self.emit_cell(s, indent),
            Statement::RenderBlock(s) => self.emit_render(s, indent),
            Statement::NodeDecl(s) => self.emit_node(s, indent),
            Statement::ChannelDecl(s) => self.emit_channel(s, indent),
            Statement::MeshDecl(s) => self.emit_mesh(s, indent),
            Statement::ConnectStmt(s) => self.emit_connect(s, indent),
            Statement::EncryptDecl(s) => self.emit_encrypt(s, indent),
        }
    }

    /* ── Layer 1 ───────────────────────────────────────────────────────── */

    fn emit_passthrough(&mut self, stmt: &TSPassthrough, indent: usize) {
        let rewritten = rewrite_result_sugar(&stmt.raw);
        let rows: Vec<&str> = rewritten.split('\n').collect();
        for (i, row) in rows.iter().enumerate() {
            // row.replace(/\s+$/, "")
            self.emit(row.trim_end(), indent, stmt.line + i);
        }
    }

    /* ── Layer 2 ───────────────────────────────────────────────────────── */

    fn emit_atom(&mut self, stmt: &AtomDecl, indent: usize) {
        self.atoms.push(stmt.name.clone());
        let mut line = format!("let {}", stmt.name);
        if let Some(ta) = &stmt.type_annotation {
            line += &format!(": {}", rewrite_result_sugar(ta));
        }
        if let Some(init) = &stmt.initializer {
            line += &format!(" = {}", rewrite_result_sugar(init));
        }
        self.emit(&line, indent, stmt.line);
    }

    fn emit_fn(&mut self, stmt: &FnDeclData, indent: usize, pure: bool) {
        if pure {
            self.emit("/** @pure */", indent, stmt.line);
        }
        let async_kw = if stmt.is_async { "async " } else { "" };
        let params: Vec<String> = stmt.params.iter().map(render_param).collect();
        let ret = match &stmt.return_type {
            Some(rt) => format!(": {}", rewrite_result_sugar(rt)),
            None => String::new(),
        };
        self.emit(
            &format!("{}function {}({}){} {{", async_kw, stmt.name, params.join(", "), ret),
            indent,
            stmt.line,
        );
        for s in &stmt.body {
            self.emit_statement(s, indent + 1);
        }
        self.emit("}", indent, stmt.line);
    }

    fn emit_guard(&mut self, stmt: &GuardStmt, indent: usize) {
        let cond = format!("if (!({}))", stmt.condition);
        if stmt.else_body.len() == 1 && is_inlineable(&stmt.else_body[0]) {
            if let Statement::TSPassthrough(p) = &stmt.else_body[0] {
                let inline = rewrite_result_sugar(p.raw.trim());
                self.emit(&format!("{} {{ {} }}", cond, inline), indent, stmt.line);
                return;
            }
        }
        self.emit(&format!("{} {{", cond), indent, stmt.line);
        for s in &stmt.else_body {
            self.emit_statement(s, indent + 1);
        }
        self.emit("}", indent, stmt.line);
    }

    fn emit_match(&mut self, stmt: &MatchExpr, indent: usize) {
        let disc = rewrite_result_sugar(&stmt.discriminant);
        let mut emitted_if = false;
        for arm in &stmt.arms {
            let body = format!("{{ {} }}", rewrite_result_sugar(arm.result.trim()));
            let pattern = rewrite_result_sugar(arm.pattern.trim());
            if arm.is_wildcard {
                let line = if emitted_if {
                    format!("else {}", body)
                } else {
                    body
                };
                self.emit(&line, indent, arm.line);
            } else if !emitted_if {
                self.emit(&format!("if ({} === {}) {}", disc, pattern, body), indent, arm.line);
                emitted_if = true;
            } else {
                self.emit(
                    &format!("else if ({} === {}) {}", disc, pattern, body),
                    indent,
                    arm.line,
                );
            }
        }
    }

    fn emit_output(&mut self, stmt: &OutputCall, indent: usize) {
        self.emit(
            &format!("console.log({})", rewrite_result_sugar(&stmt.argument)),
            indent,
            stmt.line,
        );
    }

    fn emit_import(&mut self, stmt: &ImportDecl, indent: usize) {
        self.emit(
            &format!("import {{ {} }} from \"{}\"", stmt.names.join(", "), stmt.module),
            indent,
            stmt.line,
        );
    }

    fn emit_meta(&mut self, stmt: &MetaBlock, indent: usize) {
        self.emit("export const __atomis_meta = {", indent, stmt.line);
        self.emit_entries(&stmt.entries, indent + 1);
        self.emit("}", indent, stmt.line);
    }

    /* ── decorators / cells / render ───────────────────────────────────── */

    fn emit_cell(&mut self, stmt: &CellBlock, indent: usize) {
        let arrow = if stmt.is_async { "async () =>" } else { "() =>" };
        self.emit(
            &format!("__atomis_cell({}, {} {{", json_string(&stmt.name), arrow),
            indent,
            stmt.line,
        );
        for s in &stmt.body {
            self.emit_statement(s, indent + 1);
        }
        self.emit("})", indent, stmt.line);
    }

    fn emit_render(&mut self, stmt: &RenderBlock, indent: usize) {
        for view in &stmt.views {
            self.emit(&format!("function {}() {{", view.name), indent, view.line);
            self.emit("return (", indent + 1, view.line);
            let jsx_rows: Vec<&str> = view.jsx.split('\n').collect();
            for (i, row) in jsx_rows.iter().enumerate() {
                self.emit(row.trim(), indent + 2, view.line + i);
            }
            self.emit(");", indent + 1, view.line);
            self.emit("}", indent, view.line);
        }
    }

    /* ── Layer 3: GhostNet ─────────────────────────────────────────────── */

    fn emit_node(&mut self, stmt: &NodeDecl, indent: usize) {
        let ident = id_to_ident(&stmt.id);
        self.emit(&format!("const {} = new GhostNode({{", ident), indent, stmt.line);
        let mut props = vec![id_entry(&stmt.id, stmt.line)];
        props.extend(stmt.config.iter().cloned());
        self.emit_entries(&props, indent + 1);
        self.emit("})", indent, stmt.line);
    }

    fn emit_channel(&mut self, stmt: &ChannelDecl, indent: usize) {
        let ident = id_to_ident(&stmt.id);
        self.emit(&format!("const {} = new GhostChannel({{", ident), indent, stmt.line);
        let mut props = vec![id_entry(&stmt.id, stmt.line)];
        props.extend(stmt.config.iter().cloned());
        self.emit_entries(&props, indent + 1);
        self.emit("})", indent, stmt.line);
    }

    fn emit_mesh(&mut self, stmt: &MeshDecl, indent: usize) {
        let ident = id_to_ident(&stmt.id);
        self.emit(&format!("const {} = new GhostMesh({{", ident), indent, stmt.line);
        let mut props = vec![id_entry(&stmt.id, stmt.line)];
        props.extend(stmt.config.iter().cloned());
        self.emit_entries(&props, indent + 1);
        self.emit("})", indent, stmt.line);
    }

    fn emit_connect(&mut self, stmt: &ConnectStmt, indent: usize) {
        let ch = id_to_ident(&stmt.channel);
        let node = id_to_ident(&stmt.node);
        self.emit(
            &format!("{}.connect({}, {})", ch, node, json_string(&stmt.transport)),
            indent,
            stmt.line,
        );
    }

    fn emit_encrypt(&mut self, stmt: &EncryptDecl, indent: usize) {
        self.emit("setEncryptionPolicy({", indent, stmt.line);
        self.emit_entries(&stmt.config, indent + 1);
        self.emit("})", indent, stmt.line);
    }

    /* ── shared helpers ────────────────────────────────────────────────── */

    fn emit_entries(&mut self, entries: &[ConfigEntry], indent: usize) {
        let n = entries.len();
        for (i, e) in entries.iter().enumerate() {
            let comma = if i < n - 1 { "," } else { "" };
            self.emit(&format!("{}: {}{}", e.key, e.value, comma), indent, e.line);
        }
    }
}

impl Default for Transformer {
    fn default() -> Self {
        Self::new()
    }
}

fn render_param(p: &Param) -> String {
    let mut s = p.name.clone();
    if let Some(ta) = &p.type_annotation {
        s += &format!(": {}", rewrite_result_sugar(ta));
    }
    if let Some(dv) = &p.default_value {
        s += &format!(" = {}", rewrite_result_sugar(dv));
    }
    s
}

fn is_inlineable(stmt: &Statement) -> bool {
    match stmt {
        Statement::TSPassthrough(p) => !p.raw.contains('\n') && !p.raw.contains('{'),
        _ => false,
    }
}

/// Build the synthetic `id: "<id>"` config entry for GhostNet objects.
fn id_entry(id: &str, line: usize) -> ConfigEntry {
    ConfigEntry {
        line,
        col: 0,
        key: "id".to_string(),
        value: json_string(id),
    }
}

/// Convert a GhostNet string id into a safe TS identifier.
pub fn id_to_ident(id: &str) -> String {
    let mapped: String = id
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '_' || c == '$' {
                c
            } else {
                '_'
            }
        })
        .collect();
    format!("__{}", mapped)
}

/* ── module-level Result sugar rewriting ─────────────────────────────────── */

/// Rewrite Atomis `Result` sugar inside a chunk of expression/statement text.
pub fn rewrite_result_sugar(text: &str) -> String {
    let mut out = text.to_string();
    out = rewrite_call(&out, "Ok", |arg| format!("{{ ok: true, value: {} }}", arg));
    out = rewrite_call(&out, "Err", |arg| format!("{{ ok: false, error: {} }}", arg));
    out = rewrite_result_type(&out);
    out
}

/// Replace `Name(arg)` calls (with balanced parentheses) using `build`.
fn rewrite_call<F>(text: &str, name: &str, build: F) -> String
where
    F: Fn(&str) -> String,
{
    let chars: Vec<char> = text.chars().collect();
    let name_chars: Vec<char> = name.chars().collect();
    let needle: Vec<char> = format!("{}(", name).chars().collect();
    let mut result = String::new();
    let mut i = 0usize;
    while i < chars.len() {
        match find_subslice(&chars, &needle, i) {
            None => {
                result.extend(&chars[i..]);
                break;
            }
            Some(idx) => {
                let prev = if idx == 0 { '\0' } else { chars[idx - 1] };
                let is_boundary = !is_call_boundary_char(prev);
                if !is_boundary {
                    result.extend(&chars[i..idx + name_chars.len()]);
                    i = idx + name_chars.len();
                    continue;
                }
                // Find the matching close paren.
                let mut depth = 0i64;
                let mut j = idx + name_chars.len();
                while j < chars.len() {
                    if chars[j] == '(' {
                        depth += 1;
                    } else if chars[j] == ')' {
                        depth -= 1;
                        if depth == 0 {
                            break;
                        }
                    }
                    j += 1;
                }
                if j >= chars.len() {
                    result.extend(&chars[i..]);
                    break;
                }
                let arg: String = chars[idx + name_chars.len() + 1..j].iter().collect();
                let arg = arg.trim();
                result.extend(&chars[i..idx]);
                result.push_str(&build(arg));
                i = j + 1;
            }
        }
    }
    result
}

/// Replace `Result<T, E>` type references with the structural union type.
fn rewrite_result_type(text: &str) -> String {
    let chars: Vec<char> = text.chars().collect();
    let needle: Vec<char> = "Result<".chars().collect();
    let mut result = String::new();
    let mut i = 0usize;
    while i < chars.len() {
        match find_subslice(&chars, &needle, i) {
            None => {
                result.extend(&chars[i..]);
                break;
            }
            Some(idx) => {
                let prev = if idx == 0 { '\0' } else { chars[idx - 1] };
                if is_call_boundary_char(prev) {
                    result.extend(&chars[i..idx + 7]);
                    i = idx + 7;
                    continue;
                }
                // Balance angle brackets.
                let mut depth = 0i64;
                let mut j = idx + 6; // points at '<'
                while j < chars.len() {
                    if chars[j] == '<' {
                        depth += 1;
                    } else if chars[j] == '>' {
                        depth -= 1;
                        if depth == 0 {
                            break;
                        }
                    }
                    j += 1;
                }
                if j >= chars.len() {
                    result.extend(&chars[i..]);
                    break;
                }
                let inner: String = chars[idx + 7..j].iter().collect();
                let (t, e) = split_top_level_comma(&inner);
                let t_type = t.trim();
                let t_type = if t_type.is_empty() { "unknown" } else { t_type };
                let e_type = match e {
                    Some(e) => {
                        let e = e.trim();
                        if e.is_empty() {
                            "Error".to_string()
                        } else {
                            e.to_string()
                        }
                    }
                    None => "Error".to_string(),
                };
                result.extend(&chars[i..idx]);
                result.push_str(&format!(
                    "{{ ok: true, value: {} }} | {{ ok: false, error: {} }}",
                    t_type, e_type
                ));
                i = j + 1;
            }
        }
    }
    result
}

/// `/[A-Za-z0-9_$.]/` — the "not a boundary" character class used by the TS
/// `rewriteCall`/`rewriteResultType` to avoid matching inside larger names.
fn is_call_boundary_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_' || c == '$' || c == '.'
}

/// Split `T, E` at the top-level comma, respecting nested generics.
fn split_top_level_comma(s: &str) -> (String, Option<String>) {
    let chars: Vec<char> = s.chars().collect();
    let mut depth = 0i64;
    for (i, &c) in chars.iter().enumerate() {
        if c == '<' || c == '(' || c == '[' {
            depth += 1;
        } else if c == '>' || c == ')' || c == ']' {
            depth -= 1;
        } else if c == ',' && depth == 0 {
            let left: String = chars[0..i].iter().collect();
            let right: String = chars[i + 1..].iter().collect();
            return (left, Some(right));
        }
    }
    (s.to_string(), None)
}

/// Find `needle` in `haystack` starting at `from`; returns the start index.
fn find_subslice(haystack: &[char], needle: &[char], from: usize) -> Option<usize> {
    if needle.is_empty() || from > haystack.len() {
        return None;
    }
    let mut i = from;
    while i + needle.len() <= haystack.len() {
        if haystack[i..i + needle.len()] == needle[..] {
            return Some(i);
        }
        i += 1;
    }
    None
}

/// Convenience wrapper: transform a program in one call.
pub fn transform(program: &Program) -> TransformResult {
    Transformer::new().transform(program)
}

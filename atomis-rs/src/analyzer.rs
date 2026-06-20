//! Semantic analyzer for the Atomis AST.
//!
//! Faithful port of `src/analyzer.ts`. Walks a `Program` and produces a flat,
//! source-ordered list of `Diagnostic`s plus collected symbol metadata. It does
//! NOT transform. Diagnostic *order* matters (the CLI prints them in order), so
//! the traversal mirrors the TS reference exactly: per block, a preregister pass
//! (which can warn on duplicates) precedes the validate pass; `connect`
//! statements are validated last.

use crate::ast::*;
use crate::parser::contains_word;
use std::collections::HashMap;

/// Severity of a diagnostic.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Severity {
    Error,
    Warn,
}

/// A single structured diagnostic message.
#[derive(Debug, Clone)]
pub struct Diagnostic {
    pub message: String,
    pub line: usize,
    pub col: usize,
    pub severity: Severity,
}

/// Recorded metadata about a declared `atom`.
#[derive(Debug, Clone)]
pub struct AtomInfo {
    pub name: String,
    pub type_annotation: Option<String>,
    pub line: usize,
}

/// The result of analyzing a program.
#[derive(Debug, Clone)]
pub struct AnalysisResult {
    pub diagnostics: Vec<Diagnostic>,
    pub atoms: Vec<AtomInfo>,
    pub node_ids: Vec<String>,
    pub channel_ids: Vec<String>,
    pub mesh_ids: Vec<String>,
    pub has_errors: bool,
}

const VALID_TRANSPORTS: &[&str] = &["bluetooth", "tcp", "ws", "ble5"];

/// A lexical scope mapping declared names to the line they were declared on.
struct Scope {
    names: HashMap<String, usize>,
}

/// The Atomis semantic analyzer.
pub struct Analyzer {
    diagnostics: Vec<Diagnostic>,
    atoms: Vec<AtomInfo>,
    // Insertion-ordered id maps (value = first-declared line).
    node_ids: Vec<(String, usize)>,
    channel_ids: Vec<(String, usize)>,
    mesh_ids: Vec<(String, usize)>,
    scopes: Vec<Scope>,
}

impl Analyzer {
    pub fn new() -> Self {
        Analyzer {
            diagnostics: Vec::new(),
            atoms: Vec::new(),
            node_ids: Vec::new(),
            channel_ids: Vec::new(),
            mesh_ids: Vec::new(),
            scopes: vec![Scope { names: HashMap::new() }],
        }
    }

    pub fn analyze(mut self, program: &Program) -> AnalysisResult {
        self.visit_block(&program.body);
        self.validate_connects(program);

        let has_errors = self.diagnostics.iter().any(|d| d.severity == Severity::Error);
        AnalysisResult {
            diagnostics: self.diagnostics,
            atoms: self.atoms,
            node_ids: self.node_ids.into_iter().map(|(k, _)| k).collect(),
            channel_ids: self.channel_ids.into_iter().map(|(k, _)| k).collect(),
            mesh_ids: self.mesh_ids.into_iter().map(|(k, _)| k).collect(),
            has_errors,
        }
    }

    /* ── diagnostics helpers ───────────────────────────────────────────── */

    fn error(&mut self, message: String, line: usize, col: usize) {
        self.diagnostics.push(Diagnostic {
            message,
            line,
            col,
            severity: Severity::Error,
        });
    }

    fn warn(&mut self, message: String, line: usize, col: usize) {
        self.diagnostics.push(Diagnostic {
            message,
            line,
            col,
            severity: Severity::Warn,
        });
    }

    /* ── scope helpers ─────────────────────────────────────────────────── */

    fn push_scope(&mut self) {
        self.scopes.push(Scope { names: HashMap::new() });
    }

    fn pop_scope(&mut self) {
        if self.scopes.len() > 1 {
            self.scopes.pop();
        }
    }

    fn declare(&mut self, name: &str, line: usize, col: usize) {
        let exists = self.scopes.last().unwrap().names.contains_key(name);
        if exists {
            self.warn(
                format!("'{}' is already declared in this scope", name),
                line,
                col,
            );
        }
        self.scopes
            .last_mut()
            .unwrap()
            .names
            .insert(name.to_string(), line);
    }

    /* ── traversal ─────────────────────────────────────────────────────── */

    fn visit_block(&mut self, body: &[Statement]) {
        // First pass: register declarations so order doesn't cause false positives.
        for stmt in body {
            self.preregister(stmt);
        }
        // Second pass: validate each statement.
        for stmt in body {
            self.visit(stmt);
        }
    }

    fn preregister(&mut self, stmt: &Statement) {
        match stmt {
            Statement::AtomDecl(s) => self.declare(&s.name, s.line, s.col),
            Statement::FnDecl(s) | Statement::PureFnDecl(s) => {
                self.declare(&s.name, s.line, s.col)
            }
            _ => {}
        }
    }

    fn visit(&mut self, stmt: &Statement) {
        match stmt {
            Statement::AtomDecl(s) => self.visit_atom(s),
            Statement::FnDecl(s) => self.visit_fn(s, false),
            Statement::PureFnDecl(s) => self.visit_fn(s, true),
            Statement::NodeDecl(s) => self.visit_node(s),
            Statement::ChannelDecl(s) => self.visit_channel(s),
            Statement::MeshDecl(s) => self.visit_mesh(s),
            Statement::GuardStmt(s) => {
                self.push_scope();
                self.visit_block(&s.else_body);
                self.pop_scope();
            }
            Statement::CellBlock(s) => {
                self.push_scope();
                self.visit_block(&s.body);
                self.pop_scope();
            }
            _ => {}
        }
    }

    /* ── atom checks ───────────────────────────────────────────────────── */

    fn visit_atom(&mut self, stmt: &AtomDecl) {
        self.atoms.push(AtomInfo {
            name: stmt.name.clone(),
            type_annotation: stmt.type_annotation.clone(),
            line: stmt.line,
        });
        self.check_basic_type(stmt);
    }

    fn check_basic_type(&mut self, stmt: &AtomDecl) {
        let ty = match &stmt.type_annotation {
            Some(t) => t.trim().to_string(),
            None => return,
        };
        let init = match &stmt.initializer {
            Some(i) => i.trim().to_string(),
            None => return,
        };
        if ty.is_empty() || init.is_empty() {
            return;
        }

        let first = init.chars().next().unwrap_or('\0');
        let is_string_literal = first == '"' || first == '\'' || first == '`';
        let is_number_literal = {
            // /^-?\d/
            let mut cs = init.chars();
            let c0 = cs.next().unwrap_or('\0');
            if c0 == '-' {
                cs.next().map(|c| c.is_ascii_digit()).unwrap_or(false)
            } else {
                c0.is_ascii_digit()
            }
        };
        let is_bool_literal = init == "true" || init == "false";
        let is_array_literal = init.starts_with('[');

        if ty == "string" && (is_number_literal || is_bool_literal) {
            self.error(
                format!(
                    "Type mismatch: atom '{}' is string but initialized with {}",
                    stmt.name, init
                ),
                stmt.line,
                stmt.col,
            );
        } else if ty == "number" && (is_string_literal || is_bool_literal) {
            self.error(
                format!(
                    "Type mismatch: atom '{}' is number but initialized with {}",
                    stmt.name, init
                ),
                stmt.line,
                stmt.col,
            );
        } else if ty == "boolean" && (is_string_literal || is_number_literal) {
            self.error(
                format!(
                    "Type mismatch: atom '{}' is boolean but initialized with {}",
                    stmt.name, init
                ),
                stmt.line,
                stmt.col,
            );
        } else if ty.ends_with("[]") && init != "[]" && !is_array_literal && init != "undefined" {
            self.warn(
                format!(
                    "atom '{}' is typed as an array but initializer is not an array literal",
                    stmt.name
                ),
                stmt.line,
                stmt.col,
            );
        }
    }

    /* ── function checks ───────────────────────────────────────────────── */

    fn visit_fn(&mut self, stmt: &FnDeclData, pure: bool) {
        self.push_scope();
        for p in &stmt.params {
            self.declare(&p.name, p.line, p.col);
        }
        self.visit_block(&stmt.body);
        if pure {
            self.check_purity(stmt);
        }
        self.pop_scope();
    }

    fn check_purity(&mut self, stmt: &FnDeclData) {
        if stmt.is_async {
            self.warn(
                format!(
                    "pure fn '{}' is async; pure functions should not perform I/O",
                    stmt.name
                ),
                stmt.line,
                stmt.col,
            );
        }
        let flat = flatten_body(&stmt.body);
        for s in flat {
            if let Statement::OutputCall(o) = s {
                self.warn(
                    format!(
                        "pure fn '{}' calls output(); pure functions must not produce side effects",
                        stmt.name
                    ),
                    o.line,
                    o.col,
                );
                continue;
            }
            if let Statement::TSPassthrough(p) = s {
                if impure_test(&p.raw) {
                    let snippet: String = p.raw.trim().chars().take(40).collect();
                    self.warn(
                        format!(
                            "pure fn '{}' appears to perform a side effect: {}",
                            stmt.name, snippet
                        ),
                        p.line,
                        p.col,
                    );
                }
            }
        }
    }

    /* ── GhostNet checks ───────────────────────────────────────────────── */

    fn visit_node(&mut self, stmt: &NodeDecl) {
        if let Some(line) = find_id(&self.node_ids, &stmt.id) {
            self.error(
                format!(
                    "Duplicate node id '{}' (first declared on line {})",
                    stmt.id, line
                ),
                stmt.line,
                stmt.col,
            );
        } else {
            self.node_ids.push((stmt.id.clone(), stmt.line));
        }
    }

    fn visit_channel(&mut self, stmt: &ChannelDecl) {
        if let Some(line) = find_id(&self.channel_ids, &stmt.id) {
            self.error(
                format!(
                    "Duplicate channel id '{}' (first declared on line {})",
                    stmt.id, line
                ),
                stmt.line,
                stmt.col,
            );
        } else {
            self.channel_ids.push((stmt.id.clone(), stmt.line));
        }
    }

    fn visit_mesh(&mut self, stmt: &MeshDecl) {
        if let Some(line) = find_id(&self.mesh_ids, &stmt.id) {
            self.error(
                format!(
                    "Duplicate mesh id '{}' (first declared on line {})",
                    stmt.id, line
                ),
                stmt.line,
                stmt.col,
            );
        } else {
            self.mesh_ids.push((stmt.id.clone(), stmt.line));
        }
    }

    fn validate_connects(&mut self, program: &Program) {
        let all = collect_connects(&program.body);
        for c in all {
            if find_id(&self.channel_ids, &c.channel).is_none() {
                self.error(
                    format!("connect references undeclared channel '{}'", c.channel),
                    c.line,
                    c.col,
                );
            }
            if find_id(&self.node_ids, &c.node).is_none() {
                self.error(
                    format!("connect references undeclared node '{}'", c.node),
                    c.line,
                    c.col,
                );
            }
            if !VALID_TRANSPORTS.contains(&c.transport.as_str()) {
                self.error(
                    format!(
                        "Invalid transport '{}'; expected one of bluetooth | tcp | ws | ble5",
                        c.transport
                    ),
                    c.line,
                    c.col,
                );
            }
        }
    }
}

impl Default for Analyzer {
    fn default() -> Self {
        Self::new()
    }
}

fn find_id(ids: &[(String, usize)], id: &str) -> Option<usize> {
    ids.iter().find(|(k, _)| k == id).map(|(_, l)| *l)
}

/// Flatten a body (recursing into guard/cell blocks) into a flat list.
fn flatten_body(body: &[Statement]) -> Vec<&Statement> {
    let mut out: Vec<&Statement> = Vec::new();
    for s in body {
        out.push(s);
        match s {
            Statement::GuardStmt(g) => out.extend(flatten_body(&g.else_body)),
            Statement::CellBlock(c) => out.extend(flatten_body(&c.body)),
            _ => {}
        }
    }
    out
}

fn collect_connects(body: &[Statement]) -> Vec<&ConnectStmt> {
    let mut out: Vec<&ConnectStmt> = Vec::new();
    for s in body {
        match s {
            Statement::ConnectStmt(c) => out.push(c),
            Statement::GuardStmt(g) => out.extend(collect_connects(&g.else_body)),
            Statement::CellBlock(c) => out.extend(collect_connects(&c.body)),
            Statement::FnDecl(f) | Statement::PureFnDecl(f) => {
                out.extend(collect_connects(&f.body))
            }
            _ => {}
        }
    }
    out
}

/// Reimplements `/\b(await|console|output|fetch|Math\.random|Date\.now)\b|\.send\(|\.scan\(/`.
fn impure_test(raw: &str) -> bool {
    contains_word(raw, "await")
        || contains_word(raw, "console")
        || contains_word(raw, "output")
        || contains_word(raw, "fetch")
        || contains_word(raw, "Math.random")
        || contains_word(raw, "Date.now")
        || raw.contains(".send(")
        || raw.contains(".scan(")
}

/// Convenience wrapper: analyze a program in one call.
pub fn analyze(program: &Program) -> AnalysisResult {
    Analyzer::new().analyze(program)
}

//! Abstract Syntax Tree (AST) node definitions for the Atomis language.
//!
//! Faithful port of `src/ast.ts`. Atomis has three syntax layers, all
//! represented here:
//!  - Layer 1: TypeScript passthrough  (`TSPassthrough`)
//!  - Layer 2: Atomis sugar            (atom, fn, pure, match, guard, Result)
//!  - Layer 3: GhostNet primitives     (node, channel, mesh, connect, encrypt)
//!
//! Every node carries 1-based `line`/`col` source coordinates, matching the TS
//! reference, so diagnostics line up exactly.

/// A verbatim chunk of TypeScript source that Atomis does not rewrite.
#[derive(Debug, Clone)]
pub struct TSPassthrough {
    pub line: usize,
    pub col: usize,
    /// The original TypeScript source text, emitted verbatim.
    pub raw: String,
}

/// A single function parameter, e.g. `text: string`.
#[derive(Debug, Clone)]
pub struct Param {
    pub line: usize,
    pub col: usize,
    pub name: String,
    pub type_annotation: Option<String>,
    pub default_value: Option<String>,
}

/// A reactive variable declaration: `atom name: Type = initializer`.
#[derive(Debug, Clone)]
pub struct AtomDecl {
    pub line: usize,
    pub col: usize,
    pub name: String,
    pub type_annotation: Option<String>,
    pub initializer: Option<String>,
}

/// Shared shape for `fn` and `pure fn` declarations (identical fields in the TS
/// reference; the enum variant records which one it is).
#[derive(Debug, Clone)]
pub struct FnDeclData {
    pub line: usize,
    pub col: usize,
    pub name: String,
    pub is_async: bool,
    pub params: Vec<Param>,
    pub return_type: Option<String>,
    pub body: Vec<Statement>,
}

/// One arm of a `MatchExpr`: `pattern => expression`.
#[derive(Debug, Clone)]
pub struct MatchArm {
    pub line: usize,
    pub col: usize,
    pub pattern: String,
    pub is_wildcard: bool,
    pub result: String,
}

/// A pattern-match expression: `match expr { p => e, _ => e }`.
#[derive(Debug, Clone)]
pub struct MatchExpr {
    pub line: usize,
    pub col: usize,
    pub discriminant: String,
    pub arms: Vec<MatchArm>,
}

/// A guard statement: `guard condition else { body }`.
#[derive(Debug, Clone)]
pub struct GuardStmt {
    pub line: usize,
    pub col: usize,
    pub condition: String,
    pub else_body: Vec<Statement>,
}

/// A notebook cell block: `@cell #name <statements>`.
#[derive(Debug, Clone)]
pub struct CellBlock {
    pub line: usize,
    pub col: usize,
    pub name: String,
    pub is_async: bool,
    pub body: Vec<Statement>,
}

/// A view declaration inside a `RenderBlock`: `view Name { JSX }`.
#[derive(Debug, Clone)]
pub struct ViewDecl {
    pub line: usize,
    pub col: usize,
    pub name: String,
    pub jsx: String,
}

/// A render block: `@render { view Name { JSX } }`.
#[derive(Debug, Clone)]
pub struct RenderBlock {
    pub line: usize,
    pub col: usize,
    pub views: Vec<ViewDecl>,
}

/// An `output(expr)` call.
#[derive(Debug, Clone)]
pub struct OutputCall {
    pub line: usize,
    pub col: usize,
    pub argument: String,
}

/// An Atomis import: `@import { a, b } from "module"`.
#[derive(Debug, Clone)]
pub struct ImportDecl {
    pub line: usize,
    pub col: usize,
    pub names: Vec<String>,
    pub module: String,
}

/// A single `key: value` entry inside a GhostNet config block or `@meta`.
#[derive(Debug, Clone)]
pub struct ConfigEntry {
    pub line: usize,
    pub col: usize,
    pub key: String,
    /// Raw value expression text (already TS-ready: bare words quoted).
    pub value: String,
}

/// A metadata block: `@meta { key: value, ... }`.
#[derive(Debug, Clone)]
pub struct MetaBlock {
    pub line: usize,
    pub col: usize,
    pub entries: Vec<ConfigEntry>,
}

/// A GhostNet node declaration: `node <kind> "<id>" { ...config }`.
#[derive(Debug, Clone)]
pub struct NodeDecl {
    pub line: usize,
    pub col: usize,
    pub kind: Option<String>,
    pub id: String,
    pub config: Vec<ConfigEntry>,
}

/// A GhostNet channel declaration: `channel "<id>" { ...config }`.
#[derive(Debug, Clone)]
pub struct ChannelDecl {
    pub line: usize,
    pub col: usize,
    pub id: String,
    pub config: Vec<ConfigEntry>,
}

/// A GhostNet mesh declaration: `mesh "<id>" { ...config }`.
#[derive(Debug, Clone)]
pub struct MeshDecl {
    pub line: usize,
    pub col: usize,
    pub id: String,
    pub config: Vec<ConfigEntry>,
}

/// A connect statement: `connect "<channel>" -> "<node>" via <transport>`.
#[derive(Debug, Clone)]
pub struct ConnectStmt {
    pub line: usize,
    pub col: usize,
    pub channel: String,
    pub node: String,
    pub transport: String,
}

/// An encryption policy declaration: `encrypt { ... }`.
#[derive(Debug, Clone)]
pub struct EncryptDecl {
    pub line: usize,
    pub col: usize,
    pub config: Vec<ConfigEntry>,
}

/// Any statement permitted at the top level or inside a block body.
///
/// Mirrors the `Statement` union in `ast.ts`. `FnDecl`/`PureFnDecl` share
/// `FnDeclData` but stay distinct variants so the analyzer/transformer can
/// branch on purity exactly as the TS `switch (stmt.type)` does.
#[derive(Debug, Clone)]
pub enum Statement {
    TSPassthrough(TSPassthrough),
    AtomDecl(AtomDecl),
    FnDecl(FnDeclData),
    PureFnDecl(FnDeclData),
    MatchExpr(MatchExpr),
    GuardStmt(GuardStmt),
    CellBlock(CellBlock),
    RenderBlock(RenderBlock),
    OutputCall(OutputCall),
    ImportDecl(ImportDecl),
    MetaBlock(MetaBlock),
    NodeDecl(NodeDecl),
    ChannelDecl(ChannelDecl),
    MeshDecl(MeshDecl),
    ConnectStmt(ConnectStmt),
    EncryptDecl(EncryptDecl),
}

impl Statement {
    /// 1-based source line where the node begins.
    pub fn line(&self) -> usize {
        match self {
            Statement::TSPassthrough(s) => s.line,
            Statement::AtomDecl(s) => s.line,
            Statement::FnDecl(s) => s.line,
            Statement::PureFnDecl(s) => s.line,
            Statement::MatchExpr(s) => s.line,
            Statement::GuardStmt(s) => s.line,
            Statement::CellBlock(s) => s.line,
            Statement::RenderBlock(s) => s.line,
            Statement::OutputCall(s) => s.line,
            Statement::ImportDecl(s) => s.line,
            Statement::MetaBlock(s) => s.line,
            Statement::NodeDecl(s) => s.line,
            Statement::ChannelDecl(s) => s.line,
            Statement::MeshDecl(s) => s.line,
            Statement::ConnectStmt(s) => s.line,
            Statement::EncryptDecl(s) => s.line,
        }
    }
}

/// Root node. A program is an ordered list of top-level statements.
#[derive(Debug, Clone)]
pub struct Program {
    pub line: usize,
    pub col: usize,
    pub body: Vec<Statement>,
}

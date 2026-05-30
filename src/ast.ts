/**
 * @file ast.ts
 * @module atomis/ast
 *
 * Abstract Syntax Tree (AST) node definitions for the Atomis language.
 *
 * Atomis has three syntax layers, all represented here:
 *  - Layer 1: TypeScript passthrough  ({@link TSPassthrough})
 *  - Layer 2: Atomis sugar            (atom, fn, pure, match, guard, Result)
 *  - Layer 3: GhostNet primitives     (node, channel, mesh, connect, encrypt)
 *
 * Every node extends {@link ASTNode} so that source positions are always
 * available for diagnostics and source-map generation.
 */

/**
 * Discriminant string literal for every concrete AST node `type`.
 * Using a union keeps `switch` statements in the analyzer/transformer
 * exhaustive and type-safe.
 */
export type ASTNodeType =
  | "Program"
  | "TSPassthrough"
  | "AtomDecl"
  | "FnDecl"
  | "PureFnDecl"
  | "Param"
  | "MatchExpr"
  | "MatchArm"
  | "GuardStmt"
  | "ResultType"
  | "OkExpr"
  | "ErrExpr"
  | "CellBlock"
  | "RenderBlock"
  | "ViewDecl"
  | "OutputCall"
  | "ImportDecl"
  | "MetaBlock"
  | "NodeDecl"
  | "ChannelDecl"
  | "MeshDecl"
  | "ConnectStmt"
  | "EncryptDecl"
  | "ConfigEntry"
  | "RawExpr";

/**
 * Base interface shared by every AST node.
 * `line` and `col` are 1-based source coordinates.
 */
export interface ASTNode {
  /** Discriminant identifying the concrete node kind. */
  type: ASTNodeType;
  /** 1-based source line where the node begins. */
  line: number;
  /** 1-based source column where the node begins. */
  col: number;
}

/**
 * Root node. A program is an ordered list of top-level statements,
 * each of which may be a passthrough chunk or an Atomis/GhostNet construct.
 */
export interface Program extends ASTNode {
  type: "Program";
  /** Top-level statements in source order. */
  body: Statement[];
}

/* ────────────────────────────────────────────────────────────────────────
 * Layer 1 — TypeScript passthrough
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * A verbatim chunk of TypeScript source that Atomis does not rewrite.
 * The transformer emits {@link TSPassthrough.raw} unchanged.
 */
export interface TSPassthrough extends ASTNode {
  type: "TSPassthrough";
  /** The original TypeScript source text, emitted verbatim. */
  raw: string;
}

/* ────────────────────────────────────────────────────────────────────────
 * Layer 2 — Atomis sugar
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * A reactive variable declaration: `atom name: Type = initializer`.
 * Transpiles to a plain `let` plus reactivity registration.
 */
export interface AtomDecl extends ASTNode {
  type: "AtomDecl";
  /** Variable name. */
  name: string;
  /** Optional TypeScript type annotation (raw text), e.g. `Node[]`. */
  typeAnnotation?: string;
  /** Optional initializer expression (raw text). */
  initializer?: string;
}

/**
 * A single function parameter, e.g. `text: string`.
 */
export interface Param extends ASTNode {
  type: "Param";
  /** Parameter name. */
  name: string;
  /** Optional type annotation (raw text). */
  typeAnnotation?: string;
  /** Optional default value (raw text). */
  defaultValue?: string;
}

/**
 * An Atomis function declaration: `fn name(params) -> ReturnType { body }`.
 * Transpiles to a standard TypeScript `function`.
 */
export interface FnDecl extends ASTNode {
  type: "FnDecl";
  /** Function name. */
  name: string;
  /** Whether the function is declared `async`. */
  isAsync: boolean;
  /** Formal parameters. */
  params: Param[];
  /** Optional return type annotation (raw text), parsed from after `->`. */
  returnType?: string;
  /** Statements composing the body. */
  body: Statement[];
}

/**
 * A pure function declaration: `pure fn name(...) -> T { ... }`.
 * Structurally identical to {@link FnDecl}; the analyzer enforces purity
 * and the transformer adds a `@pure` JSDoc marker.
 */
export interface PureFnDecl extends ASTNode {
  type: "PureFnDecl";
  name: string;
  isAsync: boolean;
  params: Param[];
  returnType?: string;
  body: Statement[];
}

/**
 * One arm of a {@link MatchExpr}: `pattern => expression`.
 * The wildcard pattern is represented with `isWildcard = true`.
 */
export interface MatchArm extends ASTNode {
  type: "MatchArm";
  /** Raw pattern text (or `_` for the wildcard). */
  pattern: string;
  /** Whether this arm is the `_` catch-all. */
  isWildcard: boolean;
  /** Raw result expression text. */
  result: string;
}

/**
 * A pattern-match expression: `match expr { p => e, _ => e }`.
 * Transpiles to a switch/if-else chain.
 */
export interface MatchExpr extends ASTNode {
  type: "MatchExpr";
  /** Raw discriminant expression text. */
  discriminant: string;
  /** Ordered match arms. */
  arms: MatchArm[];
}

/**
 * A guard statement: `guard condition else { body }`.
 * Transpiles to `if (!(condition)) { body }`.
 */
export interface GuardStmt extends ASTNode {
  type: "GuardStmt";
  /** Raw condition text. */
  condition: string;
  /** Statements run when the guard fails. */
  elseBody: Statement[];
}

/* ────────────────────────────────────────────────────────────────────────
 * Decorator-block constructs
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * A notebook cell block: `@cell #name <statements>`.
 * Transpiles to an `__atomis_cell(name, async () => { ... })` registration.
 */
export interface CellBlock extends ASTNode {
  type: "CellBlock";
  /** Cell name from the `#name` tag (without the `#`). */
  name: string;
  /** Whether the cell body contains `await` (controls async wrapper). */
  isAsync: boolean;
  /** Statements composing the cell body. */
  body: Statement[];
}

/**
 * A view declaration inside a {@link RenderBlock}: `view Name { JSX }`.
 */
export interface ViewDecl extends ASTNode {
  type: "ViewDecl";
  /** Component name. */
  name: string;
  /** Raw JSX body text. */
  jsx: string;
}

/**
 * A render block: `@render { view Name { JSX } }`.
 * Transpiles to a JSX component function.
 */
export interface RenderBlock extends ASTNode {
  type: "RenderBlock";
  /** The views declared in this render block. */
  views: ViewDecl[];
}

/**
 * An `output(expr)` call. Transpiles to `console.log(expr)` (node) or a
 * notebook display call.
 */
export interface OutputCall extends ASTNode {
  type: "OutputCall";
  /** Raw argument expression text. */
  argument: string;
}

/**
 * An Atomis import: `@import { a, b } from "module"`.
 * Transpiles to a standard `import { a, b } from "module"`.
 */
export interface ImportDecl extends ASTNode {
  type: "ImportDecl";
  /** Named bindings imported. */
  names: string[];
  /** Module specifier (without quotes). */
  module: string;
}

/**
 * A metadata block: `@meta { key: value, ... }`.
 * Transpiles to an exported `__atomis_meta` constant.
 */
export interface MetaBlock extends ASTNode {
  type: "MetaBlock";
  /** Key/value configuration entries. */
  entries: ConfigEntry[];
}

/* ────────────────────────────────────────────────────────────────────────
 * Layer 3 — GhostNet primitives
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * A single `key: value` entry inside a GhostNet config block or `@meta`.
 * `value` is the raw, already-normalized TypeScript expression text
 * (identifiers are quoted where appropriate by the parser).
 */
export interface ConfigEntry extends ASTNode {
  type: "ConfigEntry";
  /** Entry key. */
  key: string;
  /** Raw value expression text (TS-ready). */
  value: string;
}

/**
 * A GhostNet node declaration: `node <kind> "<id>" { ...config }`.
 * Transpiles to `const __<id> = new GhostNode({ id, ...config })`.
 */
export interface NodeDecl extends ASTNode {
  type: "NodeDecl";
  /** Optional node kind keyword (e.g. `relay`), if present. */
  kind?: string;
  /** Node id string (without quotes). */
  id: string;
  /** Config entries. */
  config: ConfigEntry[];
}

/**
 * A GhostNet channel declaration: `channel "<id>" { ...config }`.
 * Transpiles to `const __<id> = new GhostChannel({ id, ...config })`.
 */
export interface ChannelDecl extends ASTNode {
  type: "ChannelDecl";
  /** Channel id string (without quotes). */
  id: string;
  /** Config entries. */
  config: ConfigEntry[];
}

/**
 * A GhostNet mesh declaration: `mesh "<id>" { ...config }`.
 * Transpiles to `const __<id> = new GhostMesh({ id, ...config })`.
 */
export interface MeshDecl extends ASTNode {
  type: "MeshDecl";
  /** Mesh id string (without quotes). */
  id: string;
  /** Config entries. */
  config: ConfigEntry[];
}

/** Allowed GhostNet transport identifiers. */
export type Transport = "bluetooth" | "tcp" | "ws" | "ble5";

/**
 * A connect statement: `connect "<channel>" -> "<node>" via <transport>`.
 * Transpiles to `__<channel>.connect(__<node>, "<transport>")`.
 */
export interface ConnectStmt extends ASTNode {
  type: "ConnectStmt";
  /** Channel id (without quotes). */
  channel: string;
  /** Target node id (without quotes). */
  node: string;
  /** Transport keyword. */
  transport: string;
}

/**
 * An encryption policy declaration: `encrypt { algorithm, keyExchange, ... }`.
 * Transpiles to `setEncryptionPolicy({ ... })`.
 */
export interface EncryptDecl extends ASTNode {
  type: "EncryptDecl";
  /** Config entries. */
  config: ConfigEntry[];
}

/* ────────────────────────────────────────────────────────────────────────
 * Unions
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Any statement permitted at the top level or inside a block body.
 */
export type Statement =
  | TSPassthrough
  | AtomDecl
  | FnDecl
  | PureFnDecl
  | MatchExpr
  | GuardStmt
  | CellBlock
  | RenderBlock
  | OutputCall
  | ImportDecl
  | MetaBlock
  | NodeDecl
  | ChannelDecl
  | MeshDecl
  | ConnectStmt
  | EncryptDecl;

/**
 * The exhaustive union of all AST node kinds (statements plus helper nodes).
 */
export type AnyNode =
  | Program
  | Statement
  | Param
  | MatchArm
  | ViewDecl
  | ConfigEntry;

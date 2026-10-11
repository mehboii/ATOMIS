# atomis-rs — Rust port of the Atomis transpiler

A from-scratch Rust reimplementation of the Atomis **source-to-source
transpiler** that lives in this repo's TypeScript `src/`. Atomis reads `.ato`
files and emits **TypeScript** (it is not an interpreter); `atomis run` then
shells out to `ts-node`/Node to execute the emitted TS.

The TypeScript implementation is the reference and is left untouched. This crate
exists alongside it so the two can be diffed directly.

## Parity scope

The parity harness compares selected example/conformance outputs and diagnostics.
Matching that corpus does not prove equivalence for arbitrary input, target
correctness, or complete TypeScript passthrough compatibility.

Source maps (`.ato.map` / VLQ) now map generated lines back to source lines in
both implementations. Columns and full AST spans are not mapped.

## Module map (mirrors the TS pipeline)

| Rust | TS reference | role |
|------|--------------|------|
| [`src/lexer.rs`](src/lexer.rs) | `lexer.ts` | tokenizer |
| [`src/ast.rs`](src/ast.rs) | `ast.ts` | AST node types |
| [`src/parser.rs`](src/parser.rs) | `parser.ts` | recursive-descent parser; unrecognized input → `TSPassthrough` |
| [`src/analyzer.rs`](src/analyzer.rs) | `analyzer.ts` | scopes + diagnostics (no transformation) |
| [`src/transformer.rs`](src/transformer.rs) | `transformer.ts` | AST → TypeScript text |
| [`src/emitter.rs`](src/emitter.rs) | `emitter.ts` | appends `sourceMappingURL` (VLQ map = hook) |
| [`src/compiler.rs`](src/compiler.rs) | `compiler.ts` | pipeline orchestration |
| [`src/cli.rs`](src/cli.rs) | `cli.ts` | `build` / `check` / `run` / `watch` / `repl` |
| [`src/util.rs`](src/util.rs) | — | `JSON.stringify`-equivalent string quoting |

## Dependencies

**None.** See the rationale in [`Cargo.toml`](Cargo.toml): `clap` was declined to
keep `--help`/error text identical to the TS CLI; `notify` was replaced with a
std-only polling watcher; the few JS regexes are reproduced as explicit code so
byte-identical diagnostics carry no regex-engine risk. `cargo build` needs no
network.

## Build & test

```sh
cargo build --release          # produces target/release/atomis
cargo test --all-targets        # unit + public pipeline integration/golden tests
# From the repository root:
npm test                       # both implementations and trusted runtime fixtures
bash atomis-rs/parity.sh        # selected corpus; also needs release build
```

## Known differences and limits

Rust offsets/columns count Unicode scalar values; TypeScript uses UTF-16 units.
Astral Unicode can therefore produce different columns. Parse token category
spellings and filesystem errors can differ. Rust watch polls at 300 ms; TS uses
chokidar. Both directory builds sort file paths. Rust resolves ts-node from the
working directory or source ancestry; TS resolves from its installed package.

The library entry point is `atomis::compiler::compile`. It performs no execution
and returns empty output on semantic errors. Source is limited to 8 MiB and
parsed nesting to 64 levels. Low-level AST/transform APIs require trusted input.
See ../docs/audit/ for coverage, security boundaries and limitations.

# atomis-rs — Rust port of the Atomis transpiler

A from-scratch Rust reimplementation of the Atomis **source-to-source
transpiler** that lives in this repo's TypeScript `src/`. Atomis reads `.ato`
files and emits **TypeScript** (it is not an interpreter); `atomis run` then
shells out to `ts-node`/Node to execute the emitted TS.

The TypeScript implementation is the reference and is left untouched. This crate
exists alongside it so the two can be diffed directly.

## Parity guarantee

For any `.ato` input, this port emits **byte-identical TypeScript** and
**byte-identical diagnostics** (errors + warnings) versus the TS reference.
Proven by `parity.sh` and the ported unit tests.

Source maps (`.ato.map` / VLQ) are intentionally **out of scope** for now: the
`//# sourceMappingURL=…` comment is still emitted (so the `.ts` stays
byte-identical), but no companion `.ato.map` file is written. The hook to
reinstate it is documented in [`src/emitter.rs`](src/emitter.rs).

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
cargo test                     # 29 ported unit tests (14 lexer + 15 parser)
bash atomis-rs/parity.sh        # byte-for-byte diff vs the TS reference
```

## Known intentional divergences

1. **Source map file** — not written (see above). Emitted `.ts` is unaffected.
2. **Parse-error reporting** — the TS reference lets a `ParseError` propagate as
   an uncaught exception (Node stack trace, exit 1). This port prints the same
   `[line:col] message` cleanly to stderr and exits 1 — same failure, tidier
   output. None of the conformance inputs trigger this path.
3. **`watch`** — implemented as a std polling watcher (300 ms) rather than
   chokidar's inotify/ReadDirectoryChangesW events. Same add/change → rebuild
   behaviour; only the change-detection mechanism differs.
4. **Directory-build file ordering** — both implementations use the OS directory
   iteration order; on a given platform they agree, but neither sorts.

# Atomis architecture audit

> Prior audit snapshot. Current follow-up verification and changed duplicate/scope
> behavior are documented in [../ATOMIS_AUDIT.md](../ATOMIS_AUDIT.md),
> [../LANGUAGE_SPEC.md](../LANGUAGE_SPEC.md) and [../TESTING.md](../TESTING.md).

Discovery recorded 2026-10-11, before implementation changes. No existing `docs/` audit convention was found.

## Current architecture

The root npm package is the TypeScript reference; `atomis-rs/` is a standalone Rust binary crate, not a Cargo workspace. Both target TypeScript. `ghostvault/` and `ghostnet-proto/` are independent library crates exposed through checked-in WASM/JavaScript packages in `vendor/`. They are not compiler dependencies.

```
source -> lexer tokens -> parser Program -> analyzer diagnostics
                                        -> transformer TypeScript + line mappings
                                        -> emitter code + optional map -> CLI files
```

| Module (in both implementations) | Responsibility / interface |
| --- | --- |
| lexer | Keywords, strings/templates, comments, operators; token values, offsets, 1-based line/column. Rust offsets count Unicode scalars; TS offsets count UTF-16 units. |
| ast | Statement nodes, parameters/config entries. Expressions/types mostly remain strings; nodes have start coordinates, not full spans. |
| parser | Recognizes Atomis constructs at statement boundaries; otherwise collects raw TypeScript. Recursive brace bodies, iterative expression collection. No expression precedence tree or recovery. |
| analyzer | Two-pass declaration registration; duplicate-name warnings, literal-prefix type checks, purity heuristics, GhostNet IDs and connect transports. No general TypeScript name/type checking. |
| transformer | Direct text generation, Result sugar rewriting and per-line mappings. No optimization or intermediate representation. |
| emitter | Newline/map comment; TS emits Source Map v3. Rust currently returns no map despite its comment. |
| compiler | Orchestrates all stages. At discovery it transforms even when analysis has errors. |
| cli / main | build/check/run/watch/repl, current-directory config. CLI blocks writes/runs on semantic errors. run launches ts-node with caller permissions. REPL displays TS, does not evaluate. |
| Rust util | JSON string quoting. CLI contains a separate small JSON config parser. |

## Baseline and discovery findings

Rust: check passes with 21 binary warnings; 29 tests pass (14 lexer, 15 parser), none ignored. fmt fails; strict Clippy fails (27 binary errors including unused metadata and style). TS build and 29 unit tests pass; four runtime fixtures pass, including the user's untracked proto_demo fixture. Logs are in `evidence/baseline-*`.

Existing `atomis-rs/golden/` files are not asserted by cargo tests. Parity scripts compare selected builds/diagnostics, not arbitrary input, target validity, source maps, or semantic equivalence. CI runs npm install/build/runtime tests on three OSes; Rust and TS unit suites are absent.

Confirmed from source: top-level `}` can leave the parser cursor unchanged; string/comment termination is not checked; Result rewriting scans literals/comments as code; analysis errors still produce code through compile; run uses predictable adjacent files and Windows shell execution; non-.ato filenames can map output onto input. Details and reproduction status belong in findings.md.

## Boundaries and limitations

No formal grammar/spec beyond READMEs, code comments, examples, and tests. Full TypeScript passthrough compatibility is an aspiration, not demonstrated. No independent Atomis expression type system, native backend, optimizer, embedded GhostNet runtime, notebook runtime, or interpreter was found. Node kind is stored but not emitted. Several config keys are descriptive only. Vendored WASM provenance and live GhostNet behavior require separate verification.

User changes present at discovery: `Untitled-1.ts`, `test/cases/proto_demo.ato`, and `test/cases/proto_demo.expected` are untracked and must be preserved.

## State after confirmed fixes

The pipeline and TypeScript target are retained. `atomis-rs/src/lib.rs` now
exposes the existing stages so integration tests use the real public compiler;
the binary still delegates to CLI. `src/index.ts` provides the npm entry point.
Compilation rejects oversized/deep input before recursive stages, propagates
invalid lexical tokens as located parse errors, and skips transformation on
semantic errors. The Rust emitter now implements the existing TS line-map
format. CLI run uses exclusive unique adjacent files and Node arguments rather
than a command shell. Native/WASM protocol and vault boundaries have focused
validation fixes. No native backend, interpreter, optimizer, network runtime,
general type checker or reactive runtime was added.

Rust continuation detection now scans backwards from the current statement,
avoiding repeated whole-prefix allocations. Trailing comments retain their
source text without influencing whether the next statement is a continuation.
The TS AST type-tag union includes unused ResultType/OkExpr/ErrExpr/RawExpr tags;
the actual expression/type representation remains raw text, not those nodes.

See findings.md for fixed defects versus remaining design/integration gaps and
verification-report.md for checks and exact evidence. Initial discovery above
is intentionally retained as a before-change snapshot.

# Language capabilities

> Prior audit snapshot. Current follow-up verification and changed duplicate/scope
> behavior are documented in [../ATOMIS_AUDIT.md](../ATOMIS_AUDIT.md),
> [../LANGUAGE_SPEC.md](../LANGUAGE_SPEC.md) and [../TESTING.md](../TESTING.md).

Initial discovery, 2026-10-11. Evidence: `src/{ast,parser,analyzer,transformer}.ts` and mirrored `atomis-rs/src/*.rs`. Tested status is updated in verification-report.md.

| Construct | Actual behavior / status |
| --- | --- |
| TypeScript statements/expressions | Raw text passthrough; no general syntax/name/type validation. Partial compatibility. Operators, calls, indexing, loops and assignments are delegated to TS, not modeled as Atomis expressions. |
| atom | Optional raw type/initializer; emits let. No reactive registration implementation. |
| fn / async fn / pure fn | Parameters/defaults/raw return type; emits function. Pure is a warning heuristic and JSDoc, not enforced effect safety. |
| guard | Negated if with parsed else-body. |
| match | Strict-equality if/else statement chain; raw arm bodies, not a value-returning match expression. Discriminant is repeated. Semantics need specification before redesign. |
| Result / Ok / Err | Textually rewritten structural union/object literals. Partial nested/literal correctness at discovery. |
| output | console.log only, no notebook display implementation. |
| @import | Named import text; no import resolver. |
| @cell | Named callback registration with heuristic await detection; runtime helper absent. |
| @render / view | Emits JSX functions; CLI writes .ts rather than .tsx. Partial target integration. |
| @meta | Exported config object. |
| node / channel / mesh | Constructor calls requiring external GhostNode/GhostChannel/GhostMesh bindings. IDs validated globally; lexical reachability not validated. Node kind is unused. |
| connect | Generated connect call; declared IDs and four transports checked. Runtime/protocol state unverified. |
| encrypt | setEncryptionPolicy call; no crypto implemented by compiler. |
| literals/comments | Raw numbers, quoted strings/templates, booleans/null/undefined, line/block comments. Numeric range/escape validation delegated incompletely. ASCII-only identifier recognition. |
| diagnostics/maps | Structured semantic diagnostics and parse error coordinates; no full AST spans. Rust maps absent; TS maps line-only. |

## Post-audit verified changes

Both compilers now reject malformed termination and selected incomplete sugar,
bound source/nesting, withhold emitted code on semantic errors, preserve quoted
Result text, expand tested nested Result calls/types, and emit line-only source
maps. Nested guard await correctly makes a cell async; literal "await" does not.
Import literal escaping and generated GhostNet identifier collisions have
regression coverage. The CLI validates file extensions/options, reports version,
and uses unique exclusive execution files with direct Node invocation.

The Rust suite now has public compiler integration and exact golden assertions.
The npm audit suite tests all listed constructs at emission level; selected
arithmetic/string/type behaviors are target checked or executed. Network/JSX/
notebook emission is not evidence of runtime implementation. See verification
for final counts. Planned/unknown rows above remain limits, not newly implemented
features. In particular match, regex passthrough, full semantic checking and
GhostNet lexical scopes remain incomplete.

No language release roadmap with specified additional constructs was found. Rust source maps are explicitly deferred; swapping the vault crypto provider is a future integration hook. Native compilation, optimization, general type inference, sandboxed execution, full TS compatibility and networking runtime correctness are not established capabilities.

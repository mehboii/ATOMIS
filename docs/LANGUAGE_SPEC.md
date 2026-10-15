# Atomis language specification draft

Draft 0.1, describing the current implementation and tested behavior, 2026-10-11.
This is not a complete TypeScript grammar or a formal soundness proof. The TS
reference and Rust port must agree on tested sugar, diagnostics and emitted bytes,
except documented Unicode coordinate/filesystem/watch differences. Design gaps
below are explicit; they are not new features promised by this draft.

## Target and source

Source files use .ato. Both compilers produce TypeScript, usually .ts plus
.ts.ato.map. No standalone interpreter/native/wasm compiler backend exists.
run delegates trusted emitted source to ts-node/Node; REPL displays emitted text.
Source is capped at 8 MiB UTF-8, parsed bracket/Result/template nesting at 64.
These limits apply through compile, not arbitrary manually constructed ASTs.

Spaces/tabs/CR are whitespace; LF tokens delimit statements in relevant parser
contexts. Identifiers are lexed with ASCII letters, digits after the first,
underscore and dollar. Non-ASCII identifiers are not reliably classified;
Unicode string text is supported. Coordinates are 1-based: TS offsets/columns
count UTF-16 units, Rust counts Unicode scalars. Astral characters can differ.
// and /* */ comments are supported. Unterminated strings/templates/comments
fail with a located parse error. Numeric scanning recognizes decimal, fractional,
exponent and prefixed forms; radix/separator/BigInt/escape validation is incomplete.
Regex literals now have an opaque REGEX category under the phase-two lexical
contract below. Complete TS/JSX lexical compatibility remains partial.

## Syntax summary

Expressions/types below are raw target text, not an Atomis expression AST.

~~~text
atom name [: Type] [= expression]
[async] fn name(parameter[, parameter ...]) [-> ReturnType] { statements }
pure fn name(parameter[, parameter ...]) [-> ReturnType] { statements }
guard condition else { statements }
match expression { pattern => rawStatement, _ => rawStatement }
output(expression)
@import { name [as local], ... } from "module"
@meta { key: value, ... }
@cell #name { statements }  // inline form also ends at a blank line
@render { view Name { JSX } }
node [kind] "id" { key: value, ... }
channel "id" { key: value, ... }
mesh "id" { key: value, ... }
connect "channel" -> "node" via transport
encrypt { key: value, ... }
~~~

Unrecognized statements are collected as raw TS with partial lexical compatibility.
Raw TS controls operator precedence, associativity, evaluation order, loops,
assignment, classes and indexing. Nested arithmetic is tested by CLI fixtures;
the Atomis parser itself does not construct operator nodes or enforce their types.

## Variables, types and scopes

atom becomes mutable let, with optional raw type and initializer. No reactive
runtime is wired. Target primitive/composite types and inference belong to TS:
number, string, boolean, bigint, arrays, objects and externally declared types
are not an independently sound Atomis type system. Selected whole-literal atom
mismatches are errors; complex expressions must be checked with tsc.
Same parsed scope duplicate atoms/functions/parameters are errors. Parameters
share their function body scope. Enclosing names may be shadowed in nested
parsed functions/guards/cells. Raw TS declarations/imports are not fully tracked;
The default value-reference pass now checks the documented binding/expression subset below; complete TS binding compatibility remains partial.
Named imports now register their local binding (including aliases) in parsed scopes;
missing separators/from/alias/name are syntax errors. Raw TS imports/declarations
receive full checking only in target-check mode.

fn becomes function, async fn becomes async function. Parameter types/defaults
and return annotations are raw TS. Calls, argument count/default ordering,
return type/path completeness and assignment types require target checking.
Direct const/import rebinding is now also checked by the default value-name pass.
return remains a raw TS statement. pure adds a JSDoc marker and warnings about
selected I/O patterns; it provides no enforced purity or concurrency guarantee.

## Guard, match and Result

guard negates its condition and executes its parsed body when false. return in
that body exits the enclosing function, as in TS. Guard expressions currently
have inconsistent Result sugar rewrite coverage.

match is a statement even though its AST tag is MatchExpr. Its discriminant is
always evaluated exactly once, including a wildcard-only match. Non-wildcard
patterns are raw TS expressions evaluated lazily in source order, compared by
strict equality. First matching arm wins; patterns are not ranked by specificity.
Overlapping exact patterns therefore choose the first. There is no destructuring,
regex matching or type-pattern syntax; a regex pattern means object identity, as
for any other expression. An unmatched match with no wildcard does nothing.

A match needs a nonempty discriminant and at least one arm; each arm needs a
nonempty pattern/body. There may be one wildcard (_) and it must be last, so it
cannot hide later exact arms. Arms execute raw TS statements in independent
blocks, do not fall through and do not implicitly return values. Explicit return
exits the enclosing function; await stays in the enclosing async context. break
exits the match; continue retains an enclosing loop target. Nested parsed matches
inside functions/guards/cells are supported. Atomis sugar inside a raw arm block
is not recursively parsed; use parsed enclosing blocks/functions instead.
Lowering uses switch/case without generated binding names or callback scopes.
The discriminant is cast to unknown in generated TS to permit legitimate
unmatched/unrelated-type patterns; this cast has no runtime effect.
These are intended corrections of repeated evaluation and wildcard double-execution,
not value-match or exhaustiveness extensions.

Result<T,E> rewrites to a parenthesized structural discriminated union:
({ ok: true, value: T } | { ok: false, error: E }). Ok(value)/Err(error) rewrite
into object literals. Tested nested calls/types, strings/comments and array
union grouping work. Exact-token spacing, interpolation, regex and expression
statement grouping remain partial. No automatic error propagation operator.
Host exceptions and explicit Result checks are separate error mechanisms.

## Imports and host libraries

@import emits a named TS import, preserving name-as-alias bindings; commas and
from are required, and a trailing comma is permitted. Node/TS resolve it. No Atomis package manager,
module graph, visibility system, lock resolver or module sandbox exists.
Array/Map/Set/string/file/logging facilities come from JS/TS/Node imports.
output becomes console.log. Strings execute with JavaScript UTF-16 semantics;
binary data uses host Uint8Array/Buffer, not implicit string conversions.
Number arithmetic uses host binary64: no fixed integer widths or checked
integer overflow. Number division by zero yields host infinities/NaN; BigInt
zero division throws a host error. The compiler does not validate those rules.
Null/undefined, optional values, casts and conversions follow target semantics
and are not independently checked by Atomis. These host semantics were not all
runtime-tested in this batch and confer no soundness guarantee.

## GhostNet and notebook integration

node/channel/mesh emit const __normalized_id = new Ghost* constructors with
config. Punctuation in IDs becomes underscore; normalized collisions and global
duplicate IDs are errors. Node kind is parsed metadata and not emitted.
connect must resolve a declared channel and node in its same/enclosing parsed
lexical scope; transport must be bluetooth, tcp, ws or ble5. Forward lexical
references are retained, but calling a closure/connect before const initialization
can fail at runtime. Visibility checking is not initialization/liveness analysis.
Raw TS scopes and names are not comprehensively resolved.

encrypt emits setEncryptionPolicy, not compiler-provided encryption. @cell emits
__atomis_cell registration and a callback; lexical await detection in relevant
parsed nested bodies controls async wrapping. @meta emits __atomis_meta export.
@render emits JSX functions, but the CLI writes .ts; TSX integration is unresolved.
Ghost constructors, encryption policy, notebook and JSX helpers need real external
bindings. The network example is an emission fixture, not a standalone network app.
proto is a CBOR codec; ghostvault is a separately implemented vault library.
Neither implements sockets, TLS, cancellation, discovery or network concurrency.

## Diagnostics, limits and compatibility

Syntax errors terminate parsing with coordinates; there is no recovery AST.
Semantic errors retain diagnostics and return empty code and no map. CLI check/
build/run fail with exit 1 for such errors. CLI source reads are bounded at 8 MiB
on a single open file descriptor and must decode as valid UTF-8. Valid builds emit line-only maps;
columns/full spans are unavailable. Runtime failure codes come from Node.
No ownership/borrow/lifetime syntax, deterministic resource management,
concurrency memory model, sandbox or formal memory safety theorem is provided.

Version reporting is package/crate 0.1.0; separate language-version selection and
compatibility guarantees are missing. This batch intentionally changes duplicate
tracked declarations from warnings to errors and rejects out-of-scope connect.
Migration: rename/remove duplicates; place referenced GhostNet declarations in a
same/enclosing scope. No accepted syntax or public result shape changed.

Unresolved decisions: complete target validation contract, remaining regex/TS lexical ambiguity,
value-match extensions, raw/sugar declaration interoperability,
initialization ordering, TSX/runtime binding contract, module visibility/versioning
and precise spans. Tests under test/semantic-regressions.mjs and atomis-rs/tests/
audit.rs anchor the limited rules clarified here.

## Phase-two regex lexical contract

Regex literals in expression-start positions are a single opaque REGEX token: source
escapes, classes, groups, quantifiers and flags are preserved rather than serialized
as a string. Division and /= after expression operands remain operators. Expression
starts include assignment/operators, opening delimiters, return/throw/case/await and
control-condition closing parentheses. A slash immediately after a closing brace is
ambiguous in the partial TS grammar and is rejected explicitly: parenthesize an
object/function expression before division, or use a semicolon before a new regex
statement. Regex after a call/parenthesized expression is division; use a semicolon
for a new statement. Interpolation supports regex at ordinary expression starts.

The core scanner validates termination, escaped line breaks, class/group balance
and flags g/i/m/s/u/y (ES2020 contract), including duplicates. Regex pattern
length is capped at 32768 scanner characters and group nesting at 64; TS counts
UTF-16 units and Rust Unicode scalars. ASCII limit boundaries are paired-tested. It does not implement
the complete ECMAScript regex grammar; range/escape/quantifier validity additionally
requires target validation. Regex matching is never performed during compilation.
Advanced d/v flags and JSX/TS lexical ambiguities are outside this initial contract.

## Optional target checking and execution contract

The TypeScript compile API accepts targetCheck: true; its CLI accepts --target-check
for check/build/run/watch. Plain compile/check remain Atomis-only for compatibility.
Target checking is strict TypeScript with ES2020, Node16 module/resolution and the
installed Node declarations. It uses an in-memory virtual .ato.ts next to the source
so normal Node imports resolve from source ancestry, and deliberately does not load
project tsconfig/plugins. Source/import TS is read and analyzed, never executed.

Core undefined value names, lexical duplicates and scope escapes are now checked
before this optional stage. Wrong calls, type/operator errors, missing/wrong returns, unresolved modules/missing exports,
malformed literals and full regex syntax are diagnosed through this target stage.
RegExp construction validates literals without matching text. On target errors,
compile returns diagnostics, empty code and no map; CLI checked builds/runs stop
before writes/execution. Diagnostics map primary generated lines to Atomis source
lines, with column 1 because maps have no source columns. Imported-file diagnostics
retain their own path/coordinates. Module-graph and type soundness depend on TS,
not an independent Atomis proof; unchecked any in proto remains any.

Rust core compilation remains Node-independent and does not expose --target-check.
Its emitted files can use node dist/target-check.js generated.ts, which returns
exit 1 on target errors and generated-file coordinates. Default paired compiler
behavior is still tested; the extra TS CLI flag is an intentional current difference.
Rust target checking before output writes remains a continuation task.

run alone requests execution through ts-node; no check/build/target-validation
operation automatically runs supplied programs. No native backend is introduced.
The loopback example uses node:net plus proto: one EOF-framed message, 64 KiB caps,
local ephemeral TCP, socket deadlines and explicit cleanup. It is a host-library
example and does not provide missing GhostNet constructors/notebook/TLS helpers.
Sugar inside raw TS try/loop/match-arm bodies is not recursively parsed; use TS
statements there or existing parsed function/guard/cell blocks.

## 2026-10-15: value-reference checking in the default pipeline

Both maintained compilers now run independent value-reference validation on the
lowered statement buffer **before emission**, regardless of --target-check.
This uses the Atomis lexer and lexical binding tables, not TypeScript diagnostic
filtering, type inference, module loading, or execution. The additional pass is
src/name-check.ts / atomis-rs/src/name_check.rs, called by each compiler module.
The structural analyzer still owns Atomis declaration/GhostNet/purity rules.

The verified binding forms are atom/lowered let, raw let/const/var, fn/lowered
functions and parameters/defaults, nested functions, named function expressions,
ordinary block/guard scopes, loop headers, catch bindings, named/default/namespace
import bindings, destructured variable/parameter bindings, and ordinary arrow
callbacks, method parameters and simple class fields/methods. Function parameters share their body scope. A nested declaration may
shadow an enclosing binding; a let/const/parameter binding does not escape its
block/function/loop/catch. var uses the enclosing function scope. References
can resolve enclosing declarations, including forward lexical references; this
is visibility checking, not temporal-dead-zone/initialization analysis.

Value-reference traversal covers lowered initializers, calls/arguments, returns,
guard/if/loop conditions, assignment operands, arrays/object values/shorthand,
computed property expressions, template interpolation (including nested templates),
match discriminants/patterns/arm statements, and emitted configuration expressions.
Literal text, comments, regex bodies, noncomputed member names/object keys,
binding names and annotation text are not value references. Imported local aliases
are bindings; the original export name is not automatically a local name.

The two passes share an explicit ES/Node value-global allowlist and recognize
externally supplied GhostNode/GhostChannel/GhostMesh/setEncryptionPolicy/
__atomis_cell contracts. Recognition does not supply these runtimes. Imports
register names without proving module/export existence. Ambient declaration/type
syntax and complete TS/JSX binding compatibility remain partial: this bounded
lexical resolver is not a complete TypeScript binder. Advanced raw TS, type-only
references, overloads, labels, advanced class/member declaration syntax and destructuring
assignment require further conformance work and target checking. No claim of
complete TS passthrough or complete name/type soundness is made.

Direct assignment, compound assignment and ++/-- of a resolved const/import
binding are errors in both normal and target-check modes; mutating an object's
property does not rebind its const variable. Duplicate parsed names and raw lexical
bindings are errors. Do not infer automatic reactivity or independent type inference.

Undefined-value, duplicate-binding and direct constant-rebinding failures return
empty code/no map and make check/build fail with exit 1 before any output write.
New lowered-buffer diagnostics map to the original source line and column 1.
The optional TS stage still adds strict call arity/argument types, return types
and paths, operator/assignment types, module/export checks and full target syntax.
These type-level verdicts intentionally need not equal plain check.
Rust still has no integrated --target-check flag or Node requirement; validate
its accepted emitted TS with the documented standalone target checker.

See test/name-cases.json and test/name-feature-regressions.mjs for exact
valid/invalid sources and mode-specific expectations. Coverage is compilation-only;
runtime outcomes remain separately unverified without an OS sandbox.

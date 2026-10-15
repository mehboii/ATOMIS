# Atomis keyword and syntax verification

Verified 2026-10-16 against the actual checkout. The supplied program uses
implemented Atomis statement syntax over a TypeScript target. Successful
compilation is established separately from runtime behavior.

## 1. Exact-program results

The exact requested source is [examples/keyword_verification.ato](../examples/keyword_verification.ato).
Its four-space indentation, multiline guard and blank lines were retained.
The existing first-program example and language specification were not changed.

~~~atomis
fn describe(total: number, threshold: number) -> string {
    guard total >= threshold else {
        return "Below target"
    }
    return "Target reached"
}

atom userName: string = "Ada"
atom first: number = 18
atom second: number = 24
atom total: number = first + second
atom threshold: number = 40
atom reached: boolean = total >= threshold

output(`Hello, ${userName}!`)
output(`Total: ${total}`)
output(`Reached target: ${reached}`)
output(describe(total, threshold))
~~~

An initial discovery pass compiled the exact sample. The final suite then ran
all independent construct cases first and rechecked the complete program last.

From repository root, actual workflow commands are:

~~~powershell
node node_modules/typescript/bin/tsc -p tsconfig.json
cargo build --manifest-path atomis-rs/Cargo.toml --locked
node --expose-gc --max-old-space-size=1024 test/keyword-verification.mjs
~~~

The suite invokes these complete-program commands with absolute paths; exact
argument arrays, stdout/stderr and exit codes are in
[results.json](audit/evidence/keywords-20261016/results.json):

~~~powershell
node dist/cli.js check examples/keyword_verification.ato
node dist/cli.js check examples/keyword_verification.ato --target-check
atomis-rs/target/debug/atomis.exe check examples/keyword_verification.ato
node dist/cli.js build examples/keyword_verification.ato --target-check --out C:/Users/novtw/Music/atomis/.parity-tmp/keyword-suite-cOU3NS/whole-ts
atomis-rs/target/debug/atomis.exe build examples/keyword_verification.ato --out C:/Users/novtw/Music/atomis/.parity-tmp/keyword-suite-cOU3NS/whole-rust
node dist/target-check.js C:/Users/novtw/Music/atomis/.parity-tmp/keyword-suite-cOU3NS/whole-ts/keyword_verification.ts
node dist/target-check.js C:/Users/novtw/Music/atomis/.parity-tmp/keyword-suite-cOU3NS/whole-rust/keyword_verification.ts
~~~

The suite used the dedicated output directory shown above. The earlier exact relative
CLI commands and resolved output directory are also in
[commands.json](audit/evidence/keywords-20261016/commands.json).

**70 independent cases passed (0 failures).** The complete program passed all seven checking/build/validation commands above, each with exit 0 and empty stderr. TS and Rust emitted identical TypeScript and map bytes. Runtime execution remains **unverified**; no generated program was executed. Native Cargo tooling separately printed its nonfatal home-path canonicalization warning, retained in the evidence.

The observed AST has one FnDecl, two Param nodes, one GuardStmt with a raw
return, another raw return, six AtomDecl nodes and four OutputCall nodes.
Actual [tokens](audit/evidence/keywords-20261016/tokens.json) and
[AST](audit/evidence/keywords-20261016/ast.json) were captured from the supplied source.

| Source lines | Declaration/expression and predicted value |
| --- | --- |
| 1 | describe(total: number, threshold: number) -> string; both parameters are local to the invocation and shadow the later top-level names. |
| 2–4 | guard total >= threshold else runs its body when the comparison is false; return produces Below target and exits describe. |
| 5–6 | If the guard did not return, the raw return produces Target reached; closing brace ends the function. |
| 7, 14 | Blank lines separate statements; they introduce no binding. |
| 8 | Mutable userName: string initialized to Ada. |
| 9 | Mutable first: number initialized to 18. |
| 10 | Mutable second: number initialized to 24. |
| 11 | Mutable total: number initialized from first + second, predicted 42. |
| 12 | Mutable threshold: number initialized to 40. |
| 13 | Mutable reached: boolean initialized from total >= threshold, predicted true. |
| 15 | Interpolates userName into the greeting and emits an output call. |
| 16 | Interpolates total into Total: 42. |
| 17 | Interpolates reached into Reached target: true. |
| 18 | Passes the current numeric values to describe and outputs its returned string. |

The six atom bindings are top-level script bindings after initialization.
Their annotations are TS types, not immutable qualifiers. Initializers run once;
changing first later does not recompute total or reached automatically.
All displayed values above are predictions from the checked code, not observed runtime output.

## 2. Keyword verification table

| Construct | Lexer | Parser/AST | Semantic validation | Generation | Independent tests and status |
| --- | --- | --- | --- | --- | --- |
| fn | KEYWORD via ATOMIS_KEYWORDS and scanIdent | parseFnLike, parseParams -> FnDecl/Param; -> is ARROW | Parsed names/parameters/duplicates and value references checked in Atomis; signature compatibility/return paths checked by target stage | emitFn writes function with TS parameters and : ReturnType | No/one/multiple parameters, calls, string returns and malformed declarations; implemented for tested forms. |
| atom | KEYWORD | parseAtom -> AtomDecl; optional annotation and initializer captured as text | Duplicate/undefined names and selected literal mismatches checked in Atomis; assignment/expression types need target checking | emitAtom explicitly writes let | String/number/boolean/reference/arithmetic declarations, duplicates, undefined names, reassignment and mismatches; mutable binding emission verified. |
| guard / else | Both KEYWORD | parseGuard consumes condition up to else and parses the brace body -> GuardStmt | Nested parsed scope/reference checks; condition typing follows TS | emitGuard writes if (!(condition)) { ... } | True/false, with/without return, nested guards and malformed syntax; implemented as a statement, not a value-returning guard expression. |
| output | KEYWORD; dedicated statement-call dispatch | parseOutput -> OutputCall with raw argument text | Reference checks apply to arguments; no dedicated output argument type/arity checker | emitOutput explicitly writes console.log(argument) | String/number/boolean/expression/function/template output; zero/multiple arguments accepted; invalid references and syntax tested. It is compiler sugar, not an imported standard-library function or standalone runtime function. |

These words have genuine dedicated parsing rules. That does **not** establish
a universal reserved-name policy throughout raw TS passthrough: the independent
const fn = 1; output(fn) case is accepted. At statement start, fn dispatches to
the declaration parser; it is not merely an ordinary identifier accidentally
accepted as a function declaration.

## 3. Type and expression verification

| Token/form | Observed implementation and checks |
| --- | --- |
| string, number, boolean | Lexed as IDENT, stored as raw annotations. Selected whole-literal atom mismatches fail checkBasicType before transformation. Incompatible later assignments and complex operations fail optional strict TS validation. |
| describe, total, threshold, userName, first, second, reached | IDENT bindings/references. Parameters have function-local scope; outer script variables are separate bindings. The default value-reference pass catches missing names. |
| Quoted strings and decimal literals | STRING and NUMBER tokens. The supplied ASCII literals are preserved; this does not establish complete JS literal grammar compatibility. |
| : and = | Punctuation/operator delimit the declaration annotation/initializer. The annotation is optional; writing : with no type is a parse error. = initializes mutable atom bindings and can also occur in raw reassignment. |
| -> string | ARROW plus raw return type; parsed by parseFnLike and emitted as : string. String return correctness/missing returns are target checks, not an independent Atomis return-type system. |
| >= and + | OPERATOR tokens. Conditions and initializers remain text, not binary-expression ASTs. Numeric addition/comparison pass; Boolean-plus-number and number/string relational comparison fail target validation. String addition is valid. |
| Function calls | Names and parentheses remain raw call text, including OutputCall.argument. Target checking establishes argument count/type validity. No separate CallExpr is built for this program. |
| return | IDENT token and TSPassthrough statement, not an Atomis ReturnStmt node. Host TS defines its exit behavior and return compatibility. Parsed guard bodies can contain these raw returns. |
| Backticks / interpolation | A complete template is one opaque STRING token, including its interpolation text. parseOutput captures it unchanged; emission preserves it. Default name checking separately examines interpolation references. No template-expression AST is built by the Atomis parser. The independently tested true/false literals are IDENT tokens carrying host Boolean literal text. |
| Parentheses, commas, braces | Parameter/call delimiters and parsed block boundaries are handled by the parser. { and } have LBRACE/RBRACE categories. Raw grouping inside expressions is preserved. |
| Whitespace/newlines | Indentation is skipped as whitespace; NEWLINE tokens delimit relevant statement contexts. The exact sample needs no trailing semicolons. |

Independent template cases include plain text, variable/numeric/Boolean/multiple
interpolations, newline/backtick/escaped interpolation text, expression interpolation,
missing backticks/braces, and an empty interpolation. Unterminated templates fail
in Atomis parsing; an empty interpolation is only rejected by target validation.

The precedence test preserves both 2 + 3 * 4 and (2 + 3) * 4 in emitted arguments.
Atomis does not evaluate precedence itself; TS/JS does. Likewise Boolean evaluation
and true/false guard branch behavior were inspected at lowering level and type-checked,
but were not run. Atomis sugar inside raw TS if/loop blocks is not recursively parsed. These tests use raw TS return statements there. Nested guards are parsed statements; nested raw if/else returns
are target control flow and are separately checked.

Type annotations are optional in the syntax. Omitting an atom annotation or
function return annotation can be valid through inference. An untyped parameter
is accepted by Atomis but rejected by strict target checking as implicit any.
This is not a new mandatory Atomis annotation rule.

## 4. Compiler implementation references

| Component | Real source and applicable functions |
| --- | --- |
| Lexer | [src/lexer.ts](../src/lexer.ts): ATOMIS_KEYWORDS, scanIdent, scanNumber, scanTemplate, tokenize; operator tables recognize ->, >= and +. |
| Parser | [src/parser.ts](../src/parser.ts): parseStatement, parseFnLike, parseParams, parseAtom, parseGuard, parseOutput, parseRawStatement, rawUntil, expect, requireText. |
| AST definitions | [src/ast.ts](../src/ast.ts): FnDecl, Param, AtomDecl, GuardStmt, OutputCall, TSPassthrough, Program. |
| Structural semantics | [src/analyzer.ts](../src/analyzer.ts): preregister, declare, visitBlock, visitFn, checkBasicType; no complete expression/type inference. |
| Value resolution | [src/name-check.ts](../src/name-check.ts): validateNames, invoked before emission; bindings, enclosing visibility and interpolation references for the documented subset. |
| Transformation | [src/transformer.ts](../src/transformer.ts): emitFn, renderParam, emitAtom, emitGuard, emitOutput, emitPassthrough. Direct AST-to-TS lowering; no optimizer or expression IR. |
| Compiler | [src/compiler.ts](../src/compiler.ts): compile sequences lexer/parser -> structural semantics -> transformation -> value checks -> emitter -> optional target validation. |
| Emitter/maps | [src/emitter.ts](../src/emitter.ts): emit and buildSourceMap add TS text, sourceMappingURL and Source Map v3 line mappings; they do not execute source. |
| Strict target checks | [src/target-check.ts](../src/target-check.ts): validateTarget uses strict ES2020/Node16 TypeScript with noEmit; source/imports are analyzed, not executed. |
| CLI | [src/cli.ts](../src/cli.ts): cmdCheck, cmdBuild/buildFile, cmdRun. check has no file-write path; build refuses to write on errors reported by its selected mode. run would invoke ts-node/Node with caller privileges. |
| Rust counterpart | [lexer.rs](../atomis-rs/src/lexer.rs), [parser.rs](../atomis-rs/src/parser.rs), [ast.rs](../atomis-rs/src/ast.rs), [analyzer.rs](../atomis-rs/src/analyzer.rs), [name_check.rs](../atomis-rs/src/name_check.rs), [transformer.rs](../atomis-rs/src/transformer.rs), [compiler.rs](../atomis-rs/src/compiler.rs), [emitter.rs](../atomis-rs/src/emitter.rs), [cli.rs](../atomis-rs/src/cli.rs). Corresponding parse_atom/parse_fn_like/parse_guard/parse_output and emit_* methods implement the same tested sugar. |

The specification requires core parity for the maintained TS and Rust implementations,
apart from documented coordinate/filesystem/watch differences. This run compares
core CLI statuses and complete diagnostic text/locations, plus code/map bytes for
accepted fixtures. Rust intentionally has no --target-check CLI flag; its emitted
TS can use the standalone target checker. This is subset parity, not a full language proof.

## 5. Generated TypeScript

This is the actual generated output, also saved as
[generated.ts](audit/evidence/keywords-20261016/generated.ts), with the actual
map saved as [generated.map.json](audit/evidence/keywords-20261016/generated.map.json).
The saved evidence filenames differ from the original CLI filenames; its sourceMappingURL
retains the original name.

~~~typescript
function describe(total: number, threshold: number): string {
  if (!(total >= threshold)) { return "Below target" }
  return "Target reached"
}
let userName: string = "Ada"
let first: number = 18
let second: number = 24
let total: number = first + second
let threshold: number = 40
let reached: boolean = total >= threshold
console.log(`Hello, ${userName}!`)
console.log(`Total: ${total}`)
console.log(`Reached target: ${reached}`)
console.log(describe(total, threshold))
//# sourceMappingURL=keyword_verification.ts.ato.map
~~~

fn and -> become function and :, atom becomes let, guard becomes a negated if,
and output becomes console.log. Return text, literals, addition/comparison, calls
and template arguments are preserved. The multiline source guard is compacted
into one generated line; this changes formatting, not its specified lowering.

## 6. Negative-test results

Every source is permanent in [keyword-cases.json](../test/keyword-cases.json) and
as an independent .ato fixture under [cases/](audit/evidence/keywords-20261016/cases/).
The harness records normal compilation, target compilation, normal TS/Rust CLI
checking and Rust CLI builds for every case; rejected target cases additionally
exercise TS --target-check CLI check/build, and core-invalid cases exercise normal
TS builds. Normal API compilation uses the same compile function called by check.

| Independent fixture | Normal check / normal build | Target check / checked build | Rejecting stage and primary diagnostic |
| --- | --- | --- | --- |
| [fn/malformed](audit/evidence/keywords-20261016/cases/fn-malformed.ato) | Reject | Reject | lexer/parser: [1:4] Expected IDENT but found PUNCTUATION '(' |
| [atom/duplicate](audit/evidence/keywords-20261016/cases/atom-duplicate.ato) | Reject | Reject | Atomis structural semantics: 'x' is already declared in this scope |
| [atom/undefined](audit/evidence/keywords-20261016/cases/atom-undefined.ato) | Reject | Reject | Atomis value-reference semantics: Undefined identifier 'missing' |
| [types/untyped-parameter](audit/evidence/keywords-20261016/cases/types-untyped-parameter.ato) | Accept | Reject | TypeScript target validation: TS7006: Parameter 'x' implicitly has an 'any' type. |
| [types/empty-required-annotation](audit/evidence/keywords-20261016/cases/types-empty-required-annotation.ato) | Reject | Reject | lexer/parser: [1:9] Expected type annotation |
| [types/empty-return-annotation](audit/evidence/keywords-20261016/cases/types-empty-return-annotation.ato) | Reject | Reject | lexer/parser: [1:11] Expected return type |
| [types/string-literal-mismatch](audit/evidence/keywords-20261016/cases/types-string-literal-mismatch.ato) | Reject | Reject | Atomis structural semantics: Type mismatch: atom 'x' is string but initialized with 1 |
| [types/number-literal-mismatch](audit/evidence/keywords-20261016/cases/types-number-literal-mismatch.ato) | Reject | Reject | Atomis structural semantics: Type mismatch: atom 'x' is number but initialized with "bad" |
| [types/boolean-literal-mismatch](audit/evidence/keywords-20261016/cases/types-boolean-literal-mismatch.ato) | Reject | Reject | Atomis structural semantics: Type mismatch: atom 'x' is boolean but initialized with "bad" |
| [types/number-reassign-string](audit/evidence/keywords-20261016/cases/types-number-reassign-string.ato) | Accept | Reject | TypeScript target validation: TS2322: Type 'string' is not assignable to type 'number'. |
| [types/string-reassign-number](audit/evidence/keywords-20261016/cases/types-string-reassign-number.ato) | Accept | Reject | TypeScript target validation: TS2322: Type 'number' is not assignable to type 'string'. |
| [types/boolean-reassign-number](audit/evidence/keywords-20261016/cases/types-boolean-reassign-number.ato) | Accept | Reject | TypeScript target validation: TS2322: Type 'number' is not assignable to type 'boolean'. |
| [guard/missing-else](audit/evidence/keywords-20261016/cases/guard-missing-else.ato) | Reject | Reject | lexer/parser: [2:1] Expected KEYWORD 'else' but found EOF '' |
| [guard/empty-condition](audit/evidence/keywords-20261016/cases/guard-empty-condition.ato) | Reject | Reject | lexer/parser: [1:7] Expected guard condition |
| [output/undefined-argument](audit/evidence/keywords-20261016/cases/output-undefined-argument.ato) | Reject | Reject | Atomis value-reference semantics: Undefined identifier 'missing' |
| [output/bad-expression](audit/evidence/keywords-20261016/cases/output-bad-expression.ato) | Accept | Reject | TypeScript target validation: TS1109: Expression expected. |
| [template/missing-backtick](audit/evidence/keywords-20261016/cases/template-missing-backtick.ato) | Reject | Reject | lexer/parser: [1:8] Unterminated template literal |
| [template/missing-interpolation-close](audit/evidence/keywords-20261016/cases/template-missing-interpolation-close.ato) | Reject | Reject | lexer/parser: [1:8] Unterminated template literal |
| [template/empty-interpolation](audit/evidence/keywords-20261016/cases/template-empty-interpolation.ato) | Accept | Reject | TypeScript target validation: TS1109: Expression expected. |
| [operators/bad-add](audit/evidence/keywords-20261016/cases/operators-bad-add.ato) | Accept | Reject | TypeScript target validation: TS2365: Operator '+' cannot be applied to types 'boolean' and 'number'. |
| [operators/bad-comparison](audit/evidence/keywords-20261016/cases/operators-bad-comparison.ato) | Accept | Reject | TypeScript target validation: TS2365: Operator '>=' cannot be applied to types 'number' and 'string'. |
| [returns/wrong-value](audit/evidence/keywords-20261016/cases/returns-wrong-value.ato) | Accept | Reject | TypeScript target validation: TS2322: Type 'number' is not assignable to type 'string'. |
| [returns/missing](audit/evidence/keywords-20261016/cases/returns-missing.ato) | Accept | Reject | TypeScript target validation: TS2355: A function whose declared type is neither 'undefined', 'void', nor 'any' must return a value. |
| [returns/empty](audit/evidence/keywords-20261016/cases/returns-empty.ato) | Accept | Reject | TypeScript target validation: TS2322: Type 'undefined' is not assignable to type 'string'. |
| [negative/unknown-keyword](audit/evidence/keywords-20261016/cases/negative-unknown-keyword.ato) | Reject | Reject | Atomis value-reference semantics: Undefined identifier 'mystery'; Undefined identifier 'answer' |
| [negative/wrong-call-count](audit/evidence/keywords-20261016/cases/negative-wrong-call-count.ato) | Accept | Reject | TypeScript target validation: TS2554: Expected 1 arguments, but got 0. |
| [negative/wrong-call-type](audit/evidence/keywords-20261016/cases/negative-wrong-call-type.ato) | Accept | Reject | TypeScript target validation: TS2345: Argument of type 'string' is not assignable to parameter of type 'number'. |
| [types/empty-parameter-annotation](audit/evidence/keywords-20261016/cases/types-empty-parameter-annotation.ato) | Reject | Reject | lexer/parser: [1:9] Expected type annotation |

Unknown spellings are not all rejected as special “unknown keyword” tokens:
mystery answer = 1 becomes raw TS and is rejected for undefined value names.
Ordinary unrecognized-but-valid TS statements are permitted by design.

Malformed functions, empty annotations, unterminated strings/templates and invalid
guard syntax produce located lexer/parser errors. Literal type mismatches and
duplicates produce structural Atomis diagnostics; undefined references come from
the default value-reference stage. Calls, wrong returns, incompatible reassignment/
operators, bad raw output expressions and empty interpolation require the target stage.
The raw return/type/call cases are not claimed fully checked by normal mode.

All 15 core-invalid fixtures preserve compiler-produced valid TS/map pairs in both normal TS and Rust builds. All 28 target-invalid fixtures preserve valid output in checked TS builds. These failures return no code/map from the API.

**The unchecked-build limit is real:** 13 target-only-invalid fixtures are accepted by normal TS and Rust compilation and overwrite the control output in both unchecked modes. Examples include bad call/return/operator types, implicit any, an empty interpolation and malformed raw output expression. They are not reported as safe failed builds: the selected unchecked mode does not reject them. Use --target-check for the TS pre-write guarantee; Rust lacks integrated target validation before writes.

Primary lowered semantic/target diagnostics report column 1 because source maps
are line-only. Parse errors can provide precise columns; the corrected empty-type
error is 1:9 in both compilers. There is no parser recovery AST. Imported/type
diagnostics depend on TS. Success in plain mode is not a certificate of valid TS.

## 7. Runtime status

**Not executed. Actual stdout, stderr and exit status are unavailable.**

A fresh Docker probe used a repository-local empty config, avoiding private
Docker settings. The client exited 1 because the docker_engine named pipe was
absent. Exact arguments and stderr are in commands.json. No runtime/image was
downloaded, no privilege elevation was requested, and no generated code was run
through host Node or node:vm as a substitute.

Expected output remains:

~~~text
Hello, Ada!
Total: 42
Reached target: true
Target reached
~~~

This is a prediction. True/false guard execution, nested return behavior,
interpolation values, output side effects and operator evaluation need runtime
tests in an approved OS sandbox with filesystem/environment/network/process
restrictions and time/memory limits. Compilation and target validation alone
do not satisfy that requirement.

## 8. Confirmed bugs and fixes

1. **Rust token-category diagnostic formatting differed.** fn () {} was rejected
   at 1:4 by both compilers, but Rust used Ident/Punctuation while TS used
   IDENT/PUNCTUATION. Parser::expect now renders the existing Rust enum labels in
   the reference uppercase form. No tokenization or accepted grammar changed.
2. **TS empty-type errors were delayed.** For atom x: = 1 and fn f(x: = 1) {},
   Rust reported Expected type annotation at the missing type's = (1:9); TS
   consumed the initializer/default first and reported 1:12. parseAtom and
   parseParams now validate the annotation immediately, matching Rust and locating
   the omission at 1:9. No new mandatory type rule was introduced.

Regression coverage: [parser.test.ts](../src/tests/parser.test.ts),
[keywords.rs](../atomis-rs/tests/keywords.rs), and the cross-engine
[keyword-verification.mjs](../test/keyword-verification.mjs). The latter also uses
[keyword-artifacts.mjs](../test/keyword-artifacts.mjs) to assert real lexer categories,
AST signatures, guard negation, declaration lowering and raw/template argument preservation.

An initial harness compared API source without a trailing newline against disk
source with one; embedded sourcesContent correctly differed. Identical bytes now
feed both paths. Another test-edit attempt omitted a comma in the new Rust fixture;
the compile error was corrected. These were harness defects, not compiler failures.
Early logs and the before-fix location mismatch are retained in the evidence directory;
no expected compiler output was normalized away or weakened.

Completed relevant checks: 70 independent cross-engine cases; 61 Rust tests (all targets, including golden/property and new regressions); 30 TS lexer/parser unit tests; 14 existing parity checks; strict Clippy and JS harness syntax checks. Builds passed. Final logs/commands are in [rust-final.json](audit/evidence/keywords-20261016/rust-final.json), [final-checks.json](audit/evidence/keywords-20261016/final-checks.json) and results.json. The full npm/runtime suites were not run because suitable OS isolation was unavailable.

The language specification, first-program example and unrelated user files were
preserved. No special case for describe/Ada/42, native backend, new runtime,
dependency installation, commit or push was introduced by this task.

## 9. Remaining gaps

1. Establish an approved OS sandbox and verify actual output and true/false/
   boundary/nested control flow before claiming runtime conformance.
2. Define a stronger validation/default-build contract and add trusted pre-write
   target checking to Rust. Unchecked target-only failures remain a practical risk.
3. Extend paired expression/type/value binding conformance; Atomis has no complete
   independent expression AST/type checker and raw TS/JSX compatibility is partial.
4. Add source spans and more precise diagnostics for lowered expressions/defaults;
   preserve tested byte/map/error parity as grammar coverage expands.
5. Add isolated resource/failure testing and atomic TS/map output recovery.
   Ordinary failed-compilation preservation is not crash/disk-failure atomicity.

This verification is scoped to the supplied syntax and the independently tested
variants. It does not establish all of TypeScript, a native Atomis runtime,
reactivity, global keyword reservation, full type safety or production readiness.

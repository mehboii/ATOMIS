use atomis::analyzer::Severity;
use atomis::compiler::{compile, CompileOptions};
use atomis::lexer::{tokenize, TokenType};
use atomis::parser::parse;
use atomis::transformer::rewrite_result_sugar;

fn options() -> CompileOptions {
    CompileOptions {
        file_name: "case.ato".into(),
        output_file: "case.ts".into(),
        source_map: false,
    }
}

#[test]
fn semantic_errors_do_not_emit_code() {
    let result = compile("atom x: number = \"bad\"", &options()).unwrap();
    assert!(result.analysis.has_errors);
    assert!(result.code.is_empty());
    assert!(result.map.is_none());
    assert_eq!(
        (
            result.analysis.diagnostics[0].line,
            result.analysis.diagnostics[0].col
        ),
        (1, 1)
    );
}

#[test]
fn malformed_constructs_are_rejected() {
    for source in [
        "}",
        "@cell #x\n}",
        "atom x =",
        "atom x:",
        "fn f(a b) {}",
        "fn f(1) {}",
        "fn f() -> {}",
        "guard else {}",
        "match x { => 1 }",
        "node \"x\" { key: }",
        "@render { rubbish }",
    ] {
        assert!(compile(source, &options()).is_err(), "accepted {source}");
    }
}

#[test]
fn unterminated_literals_and_comments_are_rejected() {
    for source in ["\"open", "'open\\", "`open", "/* open"] {
        assert_eq!(tokenize(source)[0].ttype, TokenType::Invalid);
        let error = compile(source, &options()).err().unwrap();
        assert_eq!((error.line, error.col), (1, 1));
    }
}

#[test]
fn empty_and_missing_eof_token_streams_return_errors() {
    assert!(parse(vec![], "").is_err());
    let mut tokens = tokenize("x");
    tokens.pop();
    assert!(parse(tokens, "x").is_err());
}

#[test]
fn nesting_and_source_size_have_limits() {
    let source = "fn f() {".repeat(300) + &"}".repeat(300);
    assert!(compile(&source, &options())
        .err()
        .unwrap()
        .message
        .contains("nesting"));
    assert!(compile(&" ".repeat(8 * 1024 * 1024 + 1), &options())
        .err()
        .unwrap()
        .message
        .contains("8 MiB"));
}

#[test]
fn token_spans_are_unicode_scalar_offsets() {
    let source = "\"😀\"\r\natom x = 1";
    let chars: Vec<char> = source.chars().collect();
    for t in tokenize(source)
        .iter()
        .filter(|t| t.ttype != TokenType::Eof)
    {
        assert_eq!(chars[t.start..t.end].iter().collect::<String>(), t.value);
    }
    let atom = tokenize(source)
        .into_iter()
        .find(|t| t.value == "atom")
        .unwrap();
    assert_eq!((atom.line, atom.col), (2, 1));
}

#[test]
fn templates_ignore_braces_in_strings_comments_and_nested_templates() {
    for source in [
        "`${\"{\"}`",
        "`${`{${1}}`}`",
        "`${1 /* { */}`",
        "`${\"}\\\"{\"}`",
    ] {
        let tokens = tokenize(source);
        assert_eq!(tokens[0].ttype, TokenType::String, "{source}");
        assert_eq!(tokens[0].value, source);
        assert_eq!(tokens.len(), 2);
    }
}

#[test]
fn result_generic_recursion_is_bounded() {
    let source = "let x: ".to_string() + &"Result<".repeat(300) + "number" + &",Error>".repeat(300);
    assert!(compile(&source, &options())
        .err()
        .unwrap()
        .message
        .contains("nesting"));
}

#[test]
fn nested_cell_await_requires_async_but_literal_await_does_not() {
    let result = compile(
        "@cell #x { guard true else { await Promise.resolve() } }",
        &options(),
    )
    .unwrap();
    assert!(result.code.contains("async () =>"));
    let result = compile("@cell #x { output(\"await\") }", &options()).unwrap();
    assert!(!result.code.contains("async () =>"));
}

#[test]
fn import_escapes_are_not_double_escaped() {
    assert_eq!(
        compile("@import { a } from \"a\\n\"", &options())
            .unwrap()
            .code,
        "import { a } from \"a\\n\"\n"
    );
    assert_eq!(
        compile("@import { a } from 'has\"quote'", &options())
            .unwrap()
            .code,
        "import { a } from \"has\\\"quote\"\n"
    );
}

#[test]
fn generated_ghost_identifiers_cannot_collide() {
    for source in [
        "node \"a-b\" {}\nnode \"a_b\" {}",
        "node \"same\" {}\nchannel \"same\" {}",
    ] {
        let result = compile(source, &options()).unwrap();
        assert!(result.analysis.has_errors);
        assert!(result.code.is_empty());
        assert!(result
            .analysis
            .diagnostics
            .iter()
            .any(|d| d.message.contains("collides")));
    }
}

#[test]
fn result_rewriting_respects_literals_comments_and_nesting() {
    for text in [
        "\"Ok(1) Result<T,E>\"",
        "'Err(2)'",
        "`Ok(3)`",
        "// Ok(4)",
        "/* Err(5) */",
        "obj.Ok(1)",
        "myOk(1)",
    ] {
        assert_eq!(rewrite_result_sugar(text), text);
    }
    assert_eq!(
        rewrite_result_sugar("Ok(Ok(1))"),
        "{ ok: true, value: { ok: true, value: 1 } }"
    );
    assert_eq!(
        rewrite_result_sugar("Ok(\")\")"),
        "{ ok: true, value: \")\" }"
    );
    let result = rewrite_result_sugar("Result<Result<number,string>,Error>[]");
    assert!(!result.contains("Result<"));
    assert!(result.ends_with(")[]"));
}

#[test]
fn analyzer_does_not_infer_type_from_expression_prefix() {
    for source in [
        "atom x: string = 1 + 'x'",
        "atom x: number = '42'.length",
        "atom x: boolean = 1 < 2",
    ] {
        assert!(
            !compile(source, &options()).unwrap().analysis.has_errors,
            "{source}"
        );
    }
}

#[test]
fn duplicate_names_warn_and_ghost_ids_and_transports_error() {
    let r = compile("atom x = 1\natom x = 2", &options()).unwrap();
    assert_eq!(r.analysis.diagnostics[0].severity, Severity::Warn);
    for source in [
        "node \"n\" {}\nnode \"n\" {}",
        "channel \"c\" {}\nchannel \"c\" {}",
        "mesh \"m\" {}\nmesh \"m\" {}",
        "connect \"missing\" -> \"absent\" via bogus",
    ] {
        let r = compile(source, &options()).unwrap();
        assert!(r.analysis.has_errors);
        assert!(r.code.is_empty());
    }
}

#[test]
fn nested_scopes_and_purity_warnings() {
    let r = compile("atom x = 1\nfn f() { atom x = 2\n }", &options()).unwrap();
    assert!(r.analysis.diagnostics.is_empty());
    let r = compile("pure fn f() { output(1) }", &options()).unwrap();
    assert!(!r.analysis.has_errors);
    assert_eq!(r.analysis.diagnostics.len(), 1);
}

#[test]
fn atom_before_closing_brace_and_semicolon_type() {
    let r = compile("fn f() { atom x = 1 }\natom y: number;", &options()).unwrap();
    assert!(r.code.contains("let x = 1\n}"));
    assert!(r.code.contains("let y: number\n"));
}

#[test]
fn preserves_trailing_comments() {
    let commented = compile("let x = 1 // +\natom y = 2", &options()).unwrap();
    assert_eq!(commented.code, "let x = 1 // +\nlet y = 2\n");
    let flat = compile(&"let x = 1\n".repeat(10000), &options()).unwrap();
    assert_eq!(flat.code.lines().count(), 10000);
    assert_eq!(
        compile("let x = 1 // keep", &options()).unwrap().code,
        "let x = 1 // keep\n"
    );
}

#[test]
fn vlq_encodes_signed_line_deltas_and_extremes() {
    for (value, expected) in [(0, "A"), (1, "C"), (-1, "D"), (16, "gB"), (-16, "hB")] {
        assert_eq!(atomis::emitter::encode_vlq(value), expected);
    }
    // Decode independently to ensure no overflow on the public i64 boundary.
    for value in [i64::MIN, i64::MAX] {
        let encoded = atomis::emitter::encode_vlq(value);
        let mut raw = 0u128;
        let mut shift = 0;
        for c in encoded.chars() {
            let digit = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
                .find(c)
                .unwrap() as u128;
            raw |= (digit & 31) << shift;
            shift += 5;
        }
        assert_eq!(raw >> 1, u128::from(value.unsigned_abs()));
        assert_eq!(raw & 1, u128::from(value < 0));
    }
}

#[test]
fn golden_examples_match_exactly_except_checkout_line_endings() {
    for name in ["hello", "features", "network"] {
        let source = std::fs::read_to_string(format!("../examples/{name}.ato")).unwrap();
        let expected = std::fs::read_to_string(format!("golden/{name}.ts"))
            .unwrap()
            .replace("\r\n", "\n");
        let opts = CompileOptions {
            file_name: format!("{name}.ato"),
            output_file: format!("{name}.ts"),
            source_map: true,
        };
        let result = compile(&source, &opts).unwrap();
        assert_eq!(result.code.replace("\r\n", "\n"), expected, "{name}");
        assert!(result.map.is_some());
        assert_eq!(result.code, compile(&source, &opts).unwrap().code);
    }
}

#[test]
fn bounded_generated_input_never_panics_and_spans_stay_valid() {
    // Deterministic property smoke test, not a claim of coverage-guided fuzzing.
    let alphabet = [
        'a', '0', ' ', '\n', '\r', '\t', '{', '}', '(', ')', '[', ']', '"', '\'', '`', '\\', '/',
        '*', '@', '😀', 'é', '\0',
    ];
    let mut state = 0x12345678u32;
    for case in 0..1000 {
        let mut source = String::new();
        for _ in 0..case % 96 {
            state = state.wrapping_mul(1664525).wrapping_add(1013904223);
            source.push(alphabet[state as usize % alphabet.len()]);
        }
        let tokens = tokenize(&source);
        let length = source.chars().count();
        assert_eq!(tokens.last().unwrap().ttype, TokenType::Eof);
        for token in &tokens {
            assert!(token.start <= token.end && token.end <= length);
        }
        let _ = compile(&source, &options());
    }
}

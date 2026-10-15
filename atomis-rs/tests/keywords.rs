use atomis::compiler::{compile, CompileOptions};
#[test]
fn keyword_constructs_compile_with_documented_core_verdicts() {
    let options = CompileOptions {
        file_name: "keyword.ato".into(),
        output_file: "keyword.ts".into(),
        source_map: true,
    };
    for (name,source,valid) in [
("fn-no-parameters","fn f() {}\nf()",true),
("fn-one-parameter","fn f(x: number) { return x }\noutput(f(1))",true),
("fn-multiple-typed","fn add(a: number, b: number) -> number { return a + b }\noutput(add(1, 2))",true),
("fn-string-return","fn label() -> string { return \"ok\" }\noutput(label())",true),
("fn-malformed","fn () {}",false),
("fn-keyword-in-raw-binding","const fn = 1;\noutput(fn)",true),
("atom-string","atom text: string = \"Ada\"",true),
("atom-number","atom n: number = 18",true),
("atom-boolean","atom yes: boolean = true",true),
("atom-reference","atom a = 18\natom b = a",true),
("atom-arithmetic","atom a = 18\natom b = 24\natom sum = a + b",true),
("atom-duplicate","atom x = 1\natom x = 2",false),
("atom-undefined","atom x = missing",false),
("atom-reassign","atom x: number = 1\nx = 2",true),
("types-optional-atom-type","atom x = 1",true),
("types-optional-return-type","fn f() { return \"ok\" }",true),
("types-untyped-parameter","fn f(x) { return x }",true),
("types-empty-required-annotation","atom x: = 1",false),
("types-empty-return-annotation","fn f() -> {}",false),
("types-string-literal-mismatch","atom x: string = 1",false),
("types-number-literal-mismatch","atom x: number = \"bad\"",false),
("types-boolean-literal-mismatch","atom x: boolean = \"bad\"",false),
("types-number-reassign-string","atom x: number = 1\nx = \"bad\"",true),
("types-string-reassign-number","atom x: string = \"ok\"\nx = 1",true),
("types-boolean-reassign-number","atom x: boolean = true\nx = 1",true),
("guard-true","guard true else { output(\"branch\") }",true),
("guard-false","guard false else { output(\"branch\") }",true),
("guard-with-return","fn f(n: number) -> string { guard n >= 0 else { return \"negative\" }\nreturn \"ok\" }",true),
("guard-without-return","atom x = 0\nguard false else { x = 1 }\noutput(x)",true),
("guard-nested","guard false else { guard false else { output(\"nested\") } }",true),
("guard-missing-else","guard true { output(1) }",false),
("guard-empty-condition","guard else { output(1) }",false),
("output-string","output(\"hello\")",true),
("output-number","output(42)",true),
("output-boolean","output(true)",true),
("output-expression","output(18 + 24)",true),
("output-function-result","fn f() -> string { return \"ok\" }\noutput(f())",true),
("output-empty-valid","output()",true),
("output-multiple-valid","output(\"a\", 1, true)",true),
("output-undefined-argument","output(missing)",false),
("output-bad-expression","output(1 +)",true),
("template-plain","output(`hello`)",true),
("template-variable","atom userName = \"Ada\"\noutput(`Hello, ${userName}!`)",true),
("template-number","atom n = 42\noutput(`${n}`)",true),
("template-boolean","atom b = true\noutput(`${b}`)",true),
("template-multiple","atom name = \"Ada\"\natom n = 42\noutput(`${name}: ${n} ${true}`)",true),
("template-escapes","atom name = \"Ada\"\noutput(`line\\n\\`quoted\\` \\${literal} ${name}`)",true),
("template-expression","atom a = 18\natom b = 24\noutput(`${a + b >= 40}`)",true),
("template-missing-backtick","output(`unterminated)",false),
("template-missing-interpolation-close","output(`value ${1`)",false),
("template-empty-interpolation","output(`value ${}`)",true),
("operators-numeric-add","output(18 + 24)",true),
("operators-string-add","output(\"a\" + \"b\")",true),
("operators-bad-add","output(true + 1)",true),
("operators-greater-equal","atom a = 42\noutput(a >= 40)\noutput(a >= 42)\noutput(a >= 43)",true),
("operators-bad-comparison","output(1 >= \"bad\")",true),
("operators-references-and-call","fn f(x: number) -> number { return x }\natom n = 42\noutput(f(n) >= 40)",true),
("operators-boolean-expression","atom n = 42\noutput(n >= 40 && !(n >= 43))",true),
("operators-precedence","output(2 + 3 * 4 >= 14)\noutput((2 + 3) * 4 >= 14)",true),
("returns-valid","fn f() -> string { return \"ok\" }",true),
("returns-wrong-value","fn f() -> string { return 1 }",true),
("returns-missing","fn f() -> string {}",true),
("returns-empty","fn f() -> string { return }",true),
("returns-guard-and-fallback","fn f(x: boolean) -> string { guard x else { return \"no\" }\nreturn \"yes\" }",true),
("returns-nested-guard","fn f(x: boolean) -> string { guard x else { guard false else { return \"nested\" }\nreturn \"no\" }\nreturn \"yes\" }",true),
("returns-raw-conditional","fn f(x: boolean) -> string { if (x) { return \"yes\" } else { return \"no\" } }",true),
("negative-unknown-keyword","mystery answer = 1",false),
("negative-wrong-call-count","fn f(x: number) {}\nf()",true),
("negative-wrong-call-type","fn f(x: number) {}\nf(\"bad\")",true),
("types-empty-parameter-annotation","fn f(x: = 1) {}",false),
] {
  match compile(source,&options) {
   Ok(r)=>{assert_eq!(!r.analysis.has_errors,valid,"{name}: {:?}",r.analysis.diagnostics);if !valid {assert!(r.code.is_empty());assert!(r.map.is_none());}},
   Err(e)=>assert!(!valid,"{name}: {e:?}"),
  }
 }
}
#[test]
fn parser_errors_use_reference_token_labels() {
    for (source, message, line, col) in [
        ("atom x: = 1", "Expected type annotation", 1, 9),
        ("fn f(x: = 1) {}", "Expected type annotation", 1, 9),
        ("fn () {}", "Expected IDENT but found PUNCTUATION '('", 1, 4),
        ("fn f(1) {}", "Expected IDENT but found NUMBER '1'", 1, 6),
        (
            "fn f(x number) {}",
            "Expected PUNCTUATION ',' but found IDENT 'number'",
            1,
            8,
        ),
    ] {
        let e = atomis::parser::parse(atomis::lexer::tokenize(source), source).unwrap_err();
        assert_eq!(e.message, message);
        assert_eq!((e.line, e.col), (line, col));
    }
}

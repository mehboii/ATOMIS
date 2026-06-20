//! Atomis transpiler — Rust port entry point.
//!
//! Mirrors `cli.ts`'s `main(process.argv.slice(2))` invocation.

mod analyzer;
mod ast;
mod cli;
mod compiler;
mod emitter;
mod lexer;
mod parser;
mod transformer;
mod util;

fn main() {
    let argv: Vec<String> = std::env::args().skip(1).collect();
    let code = cli::main(&argv);
    std::process::exit(code);
}

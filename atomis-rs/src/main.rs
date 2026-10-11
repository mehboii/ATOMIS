//! Atomis transpiler — Rust port entry point.
//!
//! Mirrors `cli.ts`'s `main(process.argv.slice(2))` invocation.

use atomis::{analyzer, compiler};
mod cli;

fn main() {
    let argv: Vec<String> = std::env::args().skip(1).collect();
    let code = cli::main(&argv);
    std::process::exit(code);
}

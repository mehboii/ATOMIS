//! Atomis source-to-TypeScript compiler. No execution is performed by compile.
pub mod analyzer;
pub mod ast;
pub mod compiler;
pub mod emitter;
pub mod lexer;
pub mod parser;
pub mod transformer;
pub mod util;

pub mod name_check;

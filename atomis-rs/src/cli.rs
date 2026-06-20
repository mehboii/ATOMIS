//! Command-line interface for the Atomis transpiler.
//!
//! Faithful port of `src/cli.ts`. Commands: build / watch / run / check / repl.
//! The tiny custom arg parser, help text, colour handling (auto-disabled when
//! stdout is not a TTY, like chalk) and diagnostic formatting all mirror the TS
//! reference so behaviour and piped output match byte-for-byte.

use crate::analyzer::{Diagnostic, Severity};
use crate::compiler::{compile, CompileOptions};
use std::collections::HashMap;
use std::io::{IsTerminal, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;

/* ── colours (chalk-equivalent, TTY-gated) ───────────────────────────────── */

struct Colors {
    enabled: bool,
}

impl Colors {
    fn new() -> Self {
        // chalk's default instance keys colour support off stdout.
        Colors {
            enabled: std::io::stdout().is_terminal(),
        }
    }
    fn wrap(&self, open: &str, s: &str, close: &str) -> String {
        if self.enabled {
            format!("\x1b[{}m{}\x1b[{}m", open, s, close)
        } else {
            s.to_string()
        }
    }
    fn red(&self, s: &str) -> String {
        self.wrap("31", s, "39")
    }
    fn green(&self, s: &str) -> String {
        self.wrap("32", s, "39")
    }
    fn yellow(&self, s: &str) -> String {
        self.wrap("33", s, "39")
    }
    fn cyan(&self, s: &str) -> String {
        self.wrap("36", s, "39")
    }
    fn magenta(&self, s: &str) -> String {
        self.wrap("35", s, "39")
    }
    fn gray(&self, s: &str) -> String {
        self.wrap("90", s, "39")
    }
    fn bold(&self, s: &str) -> String {
        self.wrap("1", s, "22")
    }
}

/* ── config ──────────────────────────────────────────────────────────────── */

struct AtomisConfig {
    out_dir: String,
    src_dir: String,
}

impl Default for AtomisConfig {
    fn default() -> Self {
        AtomisConfig {
            out_dir: "./dist".to_string(),
            src_dir: "./src".to_string(),
        }
    }
}

/// Load `atomis.config.json` from the working directory, merged with defaults.
fn load_config(c: &Colors) -> AtomisConfig {
    let config_path = Path::new("atomis.config.json");
    let mut cfg = AtomisConfig::default();
    if config_path.exists() {
        match std::fs::read_to_string(config_path) {
            Ok(raw) => match json::parse(&raw) {
                Ok(json::Value::Obj(entries)) => {
                    for (k, v) in entries {
                        if let json::Value::Str(s) = v {
                            match k.as_str() {
                                "outDir" => cfg.out_dir = s,
                                "srcDir" => cfg.src_dir = s,
                                _ => {}
                            }
                        }
                    }
                }
                Ok(_) => {}
                Err(e) => {
                    eprintln!(
                        "{}",
                        c.yellow(&format!(
                            "Warning: failed to parse atomis.config.json: {}",
                            e
                        ))
                    );
                }
            },
            Err(e) => {
                eprintln!(
                    "{}",
                    c.yellow(&format!(
                        "Warning: failed to parse atomis.config.json: {}",
                        e
                    ))
                );
            }
        }
    }
    cfg
}

/* ── entry point ─────────────────────────────────────────────────────────── */

/// CLI entry point. Returns the process exit code.
pub fn main(argv: &[String]) -> i32 {
    let c = Colors::new();
    let command = argv.first().map(|s| s.as_str());
    let rest: Vec<String> = argv.iter().skip(1).cloned().collect();
    match command {
        Some("build") => cmd_build(&rest, &c),
        Some("watch") => cmd_watch(&rest, &c),
        Some("run") => cmd_run(&rest, &c),
        Some("check") => cmd_check(&rest, &c),
        Some("repl") => cmd_repl(&c),
        None | Some("-h") | Some("--help") | Some("help") => {
            print_help(&c);
            0
        }
        Some(other) => {
            eprintln!("{}", c.red(&format!("Unknown command: {}", other)));
            print_help(&c);
            1
        }
    }
}

/* ── build ───────────────────────────────────────────────────────────────── */

fn cmd_build(args: &[String], c: &Colors) -> i32 {
    let (positionals, flags) = parse_args(args);
    let target = match positionals.first() {
        Some(t) => t.clone(),
        None => {
            eprintln!(
                "{}",
                c.red("Usage: atomis build <file.ato | dir> [--out <dir>]")
            );
            return 1;
        }
    };
    let config = load_config(c);
    let target_path = Path::new(&target);
    if !target_path.exists() {
        eprintln!("{}", c.red(&format!("No such file or directory: {}", target)));
        return 1;
    }

    if target_path.is_dir() {
        let out_dir = flags
            .get("out")
            .cloned()
            .unwrap_or_else(|| config.out_dir.clone());
        let files = find_ato_files(target_path);
        let mut ok = true;
        for file in &files {
            let rel = relative(&target, &file.to_string_lossy());
            let out_path = join(&out_dir, &replace_suffix(&rel, ".ato", ".ts"));
            ok = build_file(&file.to_string_lossy(), &out_path, c) && ok;
        }
        println!(
            "{}",
            c.green(&format!("Built {} file(s) → {}", files.len(), out_dir))
        );
        if !ok {
            return 1;
        }
        0
    } else {
        let out_path = match flags.get("out") {
            Some(out) => join(out, &replace_suffix(&base_name(&target), ".ato", ".ts")),
            None => replace_suffix(&target, ".ato", ".ts"),
        };
        if !build_file(&target, &out_path, c) {
            return 1;
        }
        0
    }
}

/// Compile a single `.ato` file to a `.ts` file. Returns success.
fn build_file(input_path: &str, output_path: &str, c: &Colors) -> bool {
    let source = match std::fs::read_to_string(input_path) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("{}", c.red(&format!("Cannot read {}: {}", input_path, e)));
            return false;
        }
    };
    let result = match compile(
        &source,
        &CompileOptions {
            file_name: input_path.to_string(),
            output_file: output_path.to_string(),
            source_map: true,
        },
    ) {
        Ok(r) => r,
        Err(e) => {
            // The TS reference lets a ParseError throw (uncaught); we print it
            // cleanly and fail the build instead of dumping a stack trace.
            eprintln!("{}", c.red(&format!("{}", e)));
            return false;
        }
    };

    print_diagnostics(input_path, &result.analysis.diagnostics, c);
    if result.analysis.has_errors {
        eprintln!(
            "{}",
            c.red(&format!(
                "✗ {} — build failed ({} error(s))",
                input_path,
                count_errors(&result.analysis.diagnostics)
            ))
        );
        return false;
    }

    let resolved = std::fs::canonicalize(".").unwrap_or_else(|_| PathBuf::from("."));
    let _ = resolved; // parity with path.resolve usage; create dir from output path
    if let Some(parent) = Path::new(output_path).parent() {
        if !parent.as_os_str().is_empty() {
            let _ = std::fs::create_dir_all(parent);
        }
    }
    if std::fs::write(output_path, &result.code).is_err() {
        eprintln!("{}", c.red(&format!("Cannot write {}", output_path)));
        return false;
    }
    // NOTE: source map (.ato.map) generation is out of scope for this port, so
    // unlike the TS reference no companion map file is written. The emitted .ts
    // is byte-identical regardless.
    println!("{}", c.green(&format!("✓ {} → {}", input_path, output_path)));
    true
}

/* ── watch ───────────────────────────────────────────────────────────────── */

fn cmd_watch(args: &[String], c: &Colors) -> i32 {
    let (positionals, flags) = parse_args(args);
    let config = load_config(c);
    let dir = positionals
        .first()
        .cloned()
        .unwrap_or_else(|| config.src_dir.clone());
    let out_dir = flags.get("out").cloned().unwrap_or(config.out_dir);

    println!("{}", c.cyan(&format!("Watching {} for .ato changes...", dir)));

    let rebuild = |file: &str, c: &Colors| {
        if !file.ends_with(".ato") {
            return;
        }
        let rel = relative(&dir, file);
        let out_path = join(&out_dir, &replace_suffix(&rel, ".ato", ".ts"));
        build_file(file, &out_path, c);
    };

    // Std-only polling watcher (functional equivalent of chokidar add/change).
    // ignoreInitial:false → build existing files on startup, then poll for
    // mtime changes / new files.
    let mut seen: HashMap<String, std::time::SystemTime> = HashMap::new();
    let dir_path = PathBuf::from(&dir);
    loop {
        for file in find_ato_files(&dir_path) {
            let fname = file.to_string_lossy().to_string();
            let mtime = std::fs::metadata(&file).and_then(|m| m.modified()).ok();
            if let Some(mt) = mtime {
                let changed = match seen.get(&fname) {
                    Some(prev) => *prev != mt,
                    None => true,
                };
                if changed {
                    seen.insert(fname.clone(), mt);
                    rebuild(&fname, c);
                }
            }
        }
        std::thread::sleep(Duration::from_millis(300));
    }
}

/* ── run ─────────────────────────────────────────────────────────────────── */

fn cmd_run(args: &[String], c: &Colors) -> i32 {
    let (positionals, _flags) = parse_args(args);
    let file = match positionals.first() {
        Some(f) => f.clone(),
        None => {
            eprintln!("{}", c.red("Usage: atomis run <file.ato>"));
            return 1;
        }
    };
    let source = match std::fs::read_to_string(&file) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("{}", c.red(&format!("Cannot read {}: {}", file, e)));
            return 1;
        }
    };
    let tmp_path = replace_suffix(&file, ".ato", ".__atomis__.ts");
    let result = match compile(
        &source,
        &CompileOptions {
            file_name: file.clone(),
            output_file: tmp_path.clone(),
            source_map: false,
        },
    ) {
        Ok(r) => r,
        Err(e) => {
            eprintln!("{}", c.red(&format!("{}", e)));
            return 1;
        }
    };
    print_diagnostics(&file, &result.analysis.diagnostics, c);
    if result.analysis.has_errors {
        return 1;
    }
    if std::fs::write(&tmp_path, &result.code).is_err() {
        eprintln!("{}", c.red(&format!("Cannot write {}", tmp_path)));
        return 1;
    }

    let ts_node = resolve_bin("ts-node");
    let status = if cfg!(windows) {
        std::process::Command::new("cmd")
            .args(["/C", &ts_node, &tmp_path])
            .status()
    } else {
        std::process::Command::new(&ts_node).arg(&tmp_path).status()
    };
    let _ = std::fs::remove_file(&tmp_path);
    match status {
        Ok(s) => s.code().unwrap_or(0),
        Err(e) => {
            eprintln!("{}", c.red(&format!("Failed to run ts-node: {}", e)));
            1
        }
    }
}

/* ── check ───────────────────────────────────────────────────────────────── */

fn cmd_check(args: &[String], c: &Colors) -> i32 {
    let (positionals, _flags) = parse_args(args);
    let file = match positionals.first() {
        Some(f) => f.clone(),
        None => {
            eprintln!("{}", c.red("Usage: atomis check <file.ato>"));
            return 1;
        }
    };
    let source = match std::fs::read_to_string(&file) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("{}", c.red(&format!("Cannot read {}: {}", file, e)));
            return 1;
        }
    };
    let result = match compile(
        &source,
        &CompileOptions {
            file_name: file.clone(),
            output_file: format!("{}.ts", file),
            source_map: false,
        },
    ) {
        Ok(r) => r,
        Err(e) => {
            eprintln!("{}", c.red(&format!("{}", e)));
            return 1;
        }
    };
    print_diagnostics(&file, &result.analysis.diagnostics, c);
    if result.analysis.has_errors {
        eprintln!(
            "{}",
            c.red(&format!(
                "✗ {} — {} error(s)",
                file,
                count_errors(&result.analysis.diagnostics)
            ))
        );
        1
    } else {
        println!("{}", c.green(&format!("✓ {} — no errors", file)));
        0
    }
}

/* ── repl ────────────────────────────────────────────────────────────────── */

fn cmd_repl(c: &Colors) -> i32 {
    println!(
        "{}",
        c.cyan("Atomis REPL — type Atomis, see the transpiled TypeScript. Ctrl+C to exit.")
    );
    let stdin = std::io::stdin();
    loop {
        print!("{}", c.magenta("atomis> "));
        let _ = std::io::stdout().flush();
        let mut line = String::new();
        match stdin.read_line(&mut line) {
            Ok(0) => break, // EOF
            Ok(_) => {}
            Err(_) => break,
        }
        let line = line.trim_end_matches(['\n', '\r']).to_string();
        let trimmed = line.trim();
        if trimmed == ":quit" || trimmed == ":q" {
            break;
        }
        match compile(
            &line,
            &CompileOptions {
                file_name: "<repl>".to_string(),
                output_file: "<repl>.ts".to_string(),
                source_map: false,
            },
        ) {
            Ok(result) => {
                print_diagnostics("<repl>", &result.analysis.diagnostics, c);
                print!("{}{}", c.gray("// ts:\n"), result.code);
                let _ = std::io::stdout().flush();
            }
            Err(e) => {
                eprintln!("{}", c.red(&format!("{}", e)));
            }
        }
    }
    0
}

/* ── diagnostics / helpers ───────────────────────────────────────────────── */

fn print_diagnostics(file: &str, diagnostics: &[Diagnostic], c: &Colors) {
    for d in diagnostics {
        let loc = c.gray(&format!("{}:{}:{}", file, d.line, d.col));
        let tag = match d.severity {
            Severity::Error => c.red("error"),
            Severity::Warn => c.yellow("warn"),
        };
        eprintln!("{} {} {}", loc, tag, d.message);
    }
}

fn count_errors(diagnostics: &[Diagnostic]) -> usize {
    diagnostics
        .iter()
        .filter(|d| d.severity == Severity::Error)
        .count()
}

/// Recursively collect `.ato` files under a directory.
fn find_ato_files(dir: &Path) -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = Vec::new();
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return out,
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name == "node_modules" || name.starts_with('.') {
            continue;
        }
        let full = entry.path();
        if full.is_dir() {
            out.extend(find_ato_files(&full));
        } else if name.ends_with(".ato") {
            out.push(full);
        }
    }
    out
}

/// Parse `--flag value` / `--flag` style arguments and positionals.
fn parse_args(args: &[String]) -> (Vec<String>, HashMap<String, String>) {
    let mut positionals: Vec<String> = Vec::new();
    let mut flags: HashMap<String, String> = HashMap::new();
    let mut i = 0;
    while i < args.len() {
        let a = &args[i];
        if let Some(key) = a.strip_prefix("--") {
            let next = args.get(i + 1);
            match next {
                Some(n) if !n.starts_with("--") => {
                    flags.insert(key.to_string(), n.clone());
                    i += 1;
                }
                _ => {
                    flags.insert(key.to_string(), "true".to_string());
                }
            }
        } else {
            positionals.push(a.clone());
        }
        i += 1;
    }
    (positionals, flags)
}

/// Resolve a binary from local node_modules/.bin, falling back to PATH.
fn resolve_bin(name: &str) -> String {
    let bin_name = if cfg!(windows) {
        format!("{}.cmd", name)
    } else {
        name.to_string()
    };
    let local = Path::new("node_modules").join(".bin").join(&bin_name);
    if local.exists() {
        local.to_string_lossy().to_string()
    } else {
        name.to_string()
    }
}

fn print_help(c: &Colors) {
    println!(
        "{} — the Atomis transpiler

{}
  atomis build <file.ato>            Transpile a single file
  atomis build <dir> --out <dir>     Transpile a project directory
  atomis watch <dir> [--out <dir>]   Watch and hot-transpile
  atomis run <file.ato>              Transpile and execute via ts-node
  atomis check <file.ato>            Semantic check only (no output)
  atomis repl                        Interactive Atomis shell
",
        c.bold("atomis"),
        c.bold("Usage:")
    );
}

/* ── path helpers (mirroring node `path`) ────────────────────────────────── */

fn base_name(p: &str) -> String {
    p.rsplit(|ch| ch == '/' || ch == '\\')
        .next()
        .unwrap_or(p)
        .to_string()
}

fn join(a: &str, b: &str) -> String {
    Path::new(a).join(b).to_string_lossy().to_string()
}

/// Mirror of `path.relative(from, to)` for the simple "to is under from" case
/// used by build/watch.
fn relative(from: &str, to: &str) -> String {
    let from_abs = std::fs::canonicalize(from).ok();
    let to_abs = std::fs::canonicalize(to).ok();
    if let (Some(f), Some(t)) = (from_abs, to_abs) {
        if let Ok(stripped) = t.strip_prefix(&f) {
            return stripped.to_string_lossy().to_string();
        }
    }
    // Fallback: textual prefix strip.
    let f = from.trim_end_matches(['/', '\\']);
    if let Some(stripped) = to.strip_prefix(f) {
        return stripped.trim_start_matches(['/', '\\']).to_string();
    }
    to.to_string()
}

/// Replace a trailing `from` suffix with `to` (mirrors `str.replace(/re$/,..)`).
fn replace_suffix(s: &str, from: &str, to: &str) -> String {
    if let Some(stripped) = s.strip_suffix(from) {
        format!("{}{}", stripped, to)
    } else {
        s.to_string()
    }
}

/* ── minimal JSON parser (for atomis.config.json) ────────────────────────── */

mod json {
    /// A parsed JSON value (subset sufficient for the config file).
    pub enum Value {
        Null,
        Bool(bool),
        Num(f64),
        Str(String),
        Arr(Vec<Value>),
        Obj(Vec<(String, Value)>),
    }

    pub fn parse(input: &str) -> Result<Value, String> {
        let chars: Vec<char> = input.chars().collect();
        let mut p = P { chars, pos: 0 };
        p.skip_ws();
        let v = p.value()?;
        p.skip_ws();
        if p.pos != p.chars.len() {
            return Err(format!("Unexpected token at position {}", p.pos));
        }
        Ok(v)
    }

    struct P {
        chars: Vec<char>,
        pos: usize,
    }

    impl P {
        fn peek(&self) -> char {
            self.chars.get(self.pos).copied().unwrap_or('\0')
        }
        fn skip_ws(&mut self) {
            while matches!(self.peek(), ' ' | '\t' | '\n' | '\r') {
                self.pos += 1;
            }
        }
        fn value(&mut self) -> Result<Value, String> {
            self.skip_ws();
            match self.peek() {
                '{' => self.object(),
                '[' => self.array(),
                '"' => Ok(Value::Str(self.string()?)),
                't' | 'f' => self.boolean(),
                'n' => self.null(),
                c if c == '-' || c.is_ascii_digit() => self.number(),
                c => Err(format!("Unexpected character '{}'", c)),
            }
        }
        fn object(&mut self) -> Result<Value, String> {
            self.pos += 1; // {
            let mut entries = Vec::new();
            self.skip_ws();
            if self.peek() == '}' {
                self.pos += 1;
                return Ok(Value::Obj(entries));
            }
            loop {
                self.skip_ws();
                if self.peek() != '"' {
                    return Err("Expected string key".to_string());
                }
                let key = self.string()?;
                self.skip_ws();
                if self.peek() != ':' {
                    return Err("Expected ':'".to_string());
                }
                self.pos += 1;
                let val = self.value()?;
                entries.push((key, val));
                self.skip_ws();
                match self.peek() {
                    ',' => {
                        self.pos += 1;
                    }
                    '}' => {
                        self.pos += 1;
                        break;
                    }
                    _ => return Err("Expected ',' or '}'".to_string()),
                }
            }
            Ok(Value::Obj(entries))
        }
        fn array(&mut self) -> Result<Value, String> {
            self.pos += 1; // [
            let mut items = Vec::new();
            self.skip_ws();
            if self.peek() == ']' {
                self.pos += 1;
                return Ok(Value::Arr(items));
            }
            loop {
                let val = self.value()?;
                items.push(val);
                self.skip_ws();
                match self.peek() {
                    ',' => {
                        self.pos += 1;
                    }
                    ']' => {
                        self.pos += 1;
                        break;
                    }
                    _ => return Err("Expected ',' or ']'".to_string()),
                }
            }
            Ok(Value::Arr(items))
        }
        fn string(&mut self) -> Result<String, String> {
            self.pos += 1; // opening quote
            let mut out = String::new();
            loop {
                let c = self.peek();
                if c == '\0' {
                    return Err("Unterminated string".to_string());
                }
                self.pos += 1;
                match c {
                    '"' => break,
                    '\\' => {
                        let esc = self.peek();
                        self.pos += 1;
                        match esc {
                            '"' => out.push('"'),
                            '\\' => out.push('\\'),
                            '/' => out.push('/'),
                            'b' => out.push('\u{0008}'),
                            'f' => out.push('\u{000C}'),
                            'n' => out.push('\n'),
                            'r' => out.push('\r'),
                            't' => out.push('\t'),
                            'u' => {
                                let mut code = 0u32;
                                for _ in 0..4 {
                                    let h = self.peek();
                                    self.pos += 1;
                                    code = code * 16
                                        + h.to_digit(16).ok_or("Bad \\u escape")?;
                                }
                                if let Some(ch) = char::from_u32(code) {
                                    out.push(ch);
                                }
                            }
                            _ => return Err("Bad escape".to_string()),
                        }
                    }
                    _ => out.push(c),
                }
            }
            Ok(out)
        }
        fn boolean(&mut self) -> Result<Value, String> {
            if self.chars[self.pos..].starts_with(&['t', 'r', 'u', 'e']) {
                self.pos += 4;
                Ok(Value::Bool(true))
            } else if self.chars[self.pos..].starts_with(&['f', 'a', 'l', 's', 'e']) {
                self.pos += 5;
                Ok(Value::Bool(false))
            } else {
                Err("Invalid literal".to_string())
            }
        }
        fn null(&mut self) -> Result<Value, String> {
            if self.chars[self.pos..].starts_with(&['n', 'u', 'l', 'l']) {
                self.pos += 4;
                Ok(Value::Null)
            } else {
                Err("Invalid literal".to_string())
            }
        }
        fn number(&mut self) -> Result<Value, String> {
            let start = self.pos;
            if self.peek() == '-' {
                self.pos += 1;
            }
            while self.peek().is_ascii_digit() {
                self.pos += 1;
            }
            if self.peek() == '.' {
                self.pos += 1;
                while self.peek().is_ascii_digit() {
                    self.pos += 1;
                }
            }
            if matches!(self.peek(), 'e' | 'E') {
                self.pos += 1;
                if matches!(self.peek(), '+' | '-') {
                    self.pos += 1;
                }
                while self.peek().is_ascii_digit() {
                    self.pos += 1;
                }
            }
            let s: String = self.chars[start..self.pos].iter().collect();
            s.parse::<f64>()
                .map(Value::Num)
                .map_err(|_| "Invalid number".to_string())
        }
    }
}

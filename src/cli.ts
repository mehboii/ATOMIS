#!/usr/bin/env node
/**
 * @file cli.ts
 * @module atomis/cli
 *
 * Command-line interface for the Atomis transpiler.
 *
 * Commands:
 *  - `atomis build <file.ato>`            transpile a single file
 *  - `atomis build <dir> --out <dir>`     transpile a project directory
 *  - `atomis watch <dir>`                 watch + hot transpile
 *  - `atomis run <file.ato>`              transpile then execute with ts-node
 *  - `atomis repl`                        interactive Atomis shell
 *  - `atomis check <file.ato>`            semantic check only (no output)
 *
 * Configuration is read from `atomis.config.json` when present.
 */

import { spawn, spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import { Diagnostic } from "./analyzer";
import { compile } from "./compiler";

/* chalk v4 is CommonJS-friendly. */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const chalk = require("chalk");

/** Shape of `atomis.config.json`. */
interface AtomisConfig {
  target?: string;
  outDir?: string;
  srcDir?: string;
  ghostnet?: { sdkPath?: string; platform?: string };
  notebook?: { runtime?: string; outputFormat?: string };
  strict?: boolean;
}

/** Default config used when no `atomis.config.json` is found. */
const DEFAULT_CONFIG: AtomisConfig = {
  target: "ghostnet",
  outDir: "./dist",
  srcDir: "./src",
  strict: false,
};

/**
 * CLI entry point.
 * @param argv Raw process arguments (excluding `node` and script path).
 */
export function main(argv: string[]): void {
  const [command, ...rest] = argv;
  switch (command) {
    case "build":
      cmdBuild(rest);
      break;
    case "watch":
      cmdWatch(rest);
      break;
    case "run":
      cmdRun(rest);
      break;
    case "check":
      cmdCheck(rest);
      break;
    case "repl":
      cmdRepl();
      break;
    case undefined:
    case "-h":
    case "--help":
    case "help":
      printHelp();
      break;
    default:
      console.error(chalk.red(`Unknown command: ${command}`));
      printHelp();
      process.exitCode = 1;
  }
}

/* ── config ────────────────────────────────────────────────────────── */

/** Load `atomis.config.json` from the working directory, merged with defaults. */
function loadConfig(cwd = process.cwd()): AtomisConfig {
  const configPath = path.join(cwd, "atomis.config.json");
  if (fs.existsSync(configPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(configPath, "utf8"));
      return { ...DEFAULT_CONFIG, ...raw };
    } catch (err) {
      console.error(chalk.yellow(`Warning: failed to parse atomis.config.json: ${(err as Error).message}`));
    }
  }
  return { ...DEFAULT_CONFIG };
}

/* ── build ─────────────────────────────────────────────────────────── */

/** Implement the `build` command for a file or directory. */
function cmdBuild(args: string[]): void {
  const { positionals, flags } = parseArgs(args);
  const target = positionals[0];
  if (!target) {
    console.error(chalk.red("Usage: atomis build <file.ato | dir> [--out <dir>]"));
    process.exitCode = 1;
    return;
  }
  const config = loadConfig();
  const stat = fs.existsSync(target) ? fs.statSync(target) : null;
  if (!stat) {
    console.error(chalk.red(`No such file or directory: ${target}`));
    process.exitCode = 1;
    return;
  }

  if (stat.isDirectory()) {
    const outDir = flags.out ?? config.outDir ?? "./dist";
    const files = findAtoFiles(target);
    let ok = true;
    for (const file of files) {
      const rel = path.relative(target, file);
      const outPath = path.join(outDir, rel.replace(/\.ato$/, ".ts"));
      ok = buildFile(file, outPath) && ok;
    }
    console.log(chalk.green(`Built ${files.length} file(s) → ${outDir}`));
    if (!ok) process.exitCode = 1;
  } else {
    const outPath = flags.out
      ? path.join(flags.out, path.basename(target).replace(/\.ato$/, ".ts"))
      : target.replace(/\.ato$/, ".ts");
    if (!buildFile(target, outPath)) process.exitCode = 1;
  }
}

/**
 * Compile a single `.ato` file to a `.ts` file (and `.ato.map`).
 * @returns Whether the build succeeded (no error diagnostics).
 */
function buildFile(inputPath: string, outputPath: string): boolean {
  const source = fs.readFileSync(inputPath, "utf8");
  const result = compile(source, {
    fileName: inputPath,
    outputFile: outputPath,
  });

  printDiagnostics(inputPath, result.analysis.diagnostics);
  if (result.analysis.hasErrors) {
    console.error(chalk.red(`✗ ${inputPath} — build failed (${countErrors(result.analysis.diagnostics)} error(s))`));
    return false;
  }

  fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
  fs.writeFileSync(outputPath, result.code, "utf8");
  if (result.map) {
    // Write the map under the conventional `<base>.ato.map` name.
    const mapPath = path.join(
      path.dirname(outputPath),
      path.basename(outputPath) + ".ato.map",
    );
    fs.writeFileSync(mapPath, result.map, "utf8");
  }
  console.log(chalk.green(`✓ ${inputPath} → ${outputPath}`));
  return true;
}

/* ── watch ─────────────────────────────────────────────────────────── */

/** Implement the `watch` command using chokidar. */
function cmdWatch(args: string[]): void {
  const { positionals, flags } = parseArgs(args);
  const dir = positionals[0] ?? loadConfig().srcDir ?? ".";
  const outDir = flags.out ?? loadConfig().outDir ?? "./dist";

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const chokidar = require("chokidar");
  console.log(chalk.cyan(`Watching ${dir} for .ato changes...`));

  const rebuild = (file: string): void => {
    if (!file.endsWith(".ato")) return;
    const rel = path.relative(dir, file);
    const outPath = path.join(outDir, rel.replace(/\.ato$/, ".ts"));
    try {
      buildFile(file, outPath);
    } catch (err) {
      console.error(chalk.red(`Error building ${file}: ${(err as Error).message}`));
    }
  };

  const watcher = chokidar.watch(dir, { ignored: /node_modules/, ignoreInitial: false });
  watcher.on("add", rebuild);
  watcher.on("change", rebuild);
}

/* ── run ───────────────────────────────────────────────────────────── */

/** Implement the `run` command: transpile to a temp `.ts` and execute it. */
function cmdRun(args: string[]): void {
  const { positionals } = parseArgs(args);
  const file = positionals[0];
  if (!file) {
    console.error(chalk.red("Usage: atomis run <file.ato>"));
    process.exitCode = 1;
    return;
  }
  const source = fs.readFileSync(file, "utf8");
  const tmpPath = file.replace(/\.ato$/, ".__atomis__.ts");
  const result = compile(source, {
    fileName: file,
    outputFile: tmpPath,
    sourceMap: false,
  });
  printDiagnostics(file, result.analysis.diagnostics);
  if (result.analysis.hasErrors) {
    process.exitCode = 1;
    return;
  }
  fs.writeFileSync(tmpPath, result.code, "utf8");

  const tsNode = resolveBin("ts-node");
  const child = spawn(tsNode, [tmpPath], { stdio: "inherit", shell: process.platform === "win32" });
  child.on("exit", (code) => {
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      /* ignore cleanup failure */
    }
    process.exitCode = code ?? 0;
  });
}

/* ── check ─────────────────────────────────────────────────────────── */

/** Implement the `check` command: analyze only, emit no files. */
function cmdCheck(args: string[]): void {
  const { positionals } = parseArgs(args);
  const file = positionals[0];
  if (!file) {
    console.error(chalk.red("Usage: atomis check <file.ato>"));
    process.exitCode = 1;
    return;
  }
  const source = fs.readFileSync(file, "utf8");
  const result = compile(source, { fileName: file, outputFile: file + ".ts", sourceMap: false });
  printDiagnostics(file, result.analysis.diagnostics);
  if (result.analysis.hasErrors) {
    console.error(chalk.red(`✗ ${file} — ${countErrors(result.analysis.diagnostics)} error(s)`));
    process.exitCode = 1;
  } else {
    console.log(chalk.green(`✓ ${file} — no errors`));
  }
}

/* ── repl ──────────────────────────────────────────────────────────── */

/** Implement the interactive `repl` command. */
function cmdRepl(): void {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log(chalk.cyan("Atomis REPL — type Atomis, see the transpiled TypeScript. Ctrl+C to exit."));
  const prompt = (): void => {
    rl.question(chalk.magenta("atomis> "), (line) => {
      if (line.trim() === ":quit" || line.trim() === ":q") {
        rl.close();
        return;
      }
      try {
        const result = compile(line, { fileName: "<repl>", outputFile: "<repl>.ts", sourceMap: false });
        printDiagnostics("<repl>", result.analysis.diagnostics);
        process.stdout.write(chalk.gray("// ts:\n") + result.code);
      } catch (err) {
        console.error(chalk.red((err as Error).message));
      }
      prompt();
    });
  };
  prompt();
}

/* ── diagnostics / helpers ─────────────────────────────────────────── */

/** Pretty-print diagnostics for a file. */
function printDiagnostics(file: string, diagnostics: Diagnostic[]): void {
  for (const d of diagnostics) {
    const loc = chalk.gray(`${file}:${d.line}:${d.col}`);
    const tag =
      d.severity === "error" ? chalk.red("error") : chalk.yellow("warn");
    console.error(`${loc} ${tag} ${d.message}`);
  }
}

/** Count error-severity diagnostics. */
function countErrors(diagnostics: Diagnostic[]): number {
  return diagnostics.filter((d) => d.severity === "error").length;
}

/** Recursively collect `.ato` files under a directory. */
function findAtoFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...findAtoFiles(full));
    else if (entry.name.endsWith(".ato")) out.push(full);
  }
  return out;
}

/** Parse `--flag value` / `--flag` style arguments and positionals. */
function parseArgs(args: string[]): { positionals: string[]; flags: Record<string, string> } {
  const positionals: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = "true";
      }
    } else {
      positionals.push(a);
    }
  }
  return { positionals, flags };
}

/** Resolve a binary from local node_modules/.bin, falling back to PATH. */
function resolveBin(name: string): string {
  const binName = process.platform === "win32" ? `${name}.cmd` : name;
  const local = path.join(process.cwd(), "node_modules", ".bin", binName);
  return fs.existsSync(local) ? local : name;
}

/** Print CLI usage. */
function printHelp(): void {
  console.log(`${chalk.bold("atomis")} — the Atomis transpiler

${chalk.bold("Usage:")}
  atomis build <file.ato>            Transpile a single file
  atomis build <dir> --out <dir>     Transpile a project directory
  atomis watch <dir> [--out <dir>]   Watch and hot-transpile
  atomis run <file.ato>              Transpile and execute via ts-node
  atomis check <file.ato>            Semantic check only (no output)
  atomis repl                        Interactive Atomis shell
`);
}

// Execute when invoked directly (not when imported by tests).
if (require.main === module) {
  main(process.argv.slice(2));
}

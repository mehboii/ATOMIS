/** Optional validation using the installed TypeScript/Node target; never executes source. */
import * as ts from "typescript";
import * as path from "path";
import { readSourceFile } from "./source-file";
import type { Diagnostic } from "./analyzer";
import type { LineMapping } from "./transformer";

export function validateTarget(code: string, sourceName: string, mappings: LineMapping[] = []): Diagnostic[] {
  const fileName = path.resolve(sourceName.endsWith(".ts") ? sourceName : sourceName + ".ts");
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.Node16,
    moduleResolution: ts.ModuleResolutionKind.Node16, strict: true, noEmit: true,
    types: ["node"], typeRoots: [path.dirname(path.dirname(require.resolve("@types/node/package.json", { paths: [path.dirname(require.resolve("ts-node/package.json"))] })))],
  };
  const host = ts.createCompilerHost(options);
  const originalGet = host.getSourceFile.bind(host), originalRead = host.readFile.bind(host), originalExists = host.fileExists.bind(host);
  const same = (file: string): boolean => path.resolve(file) === fileName;
  host.getSourceFile = (file, languageVersion, onError, fresh) => same(file)
    ? ts.createSourceFile(file, code, languageVersion, true) : originalGet(file, languageVersion, onError, fresh);
  host.readFile = file => same(file) ? code : originalRead(file);
  host.fileExists = file => same(file) || originalExists(file);
  const program = ts.createProgram([fileName], options, host);
  const locate = (file: ts.SourceFile | undefined, start: number | undefined): Pick<Diagnostic, "line" | "col" | "fileName"> => {
    const pos = file?.getLineAndCharacterOfPosition(start ?? 0) ?? { line: 0, character: 0 };
    const primary = file !== undefined && same(file.fileName);
    return { line: primary ? mappings[pos.line]?.originalLine ?? pos.line + 1 : pos.line + 1,
      col: primary && mappings.length ? 1 : pos.character + 1, fileName: primary || !file ? sourceName : file.fileName };
  };
  const diagnostics: Diagnostic[] = ts.getPreEmitDiagnostics(program).map(d => ({
    message: "TS" + d.code + ": " + ts.flattenDiagnosticMessageText(d.messageText, " "),
    severity: "error", ...locate(d.file, d.start),
  }));
  const source = program.getSourceFile(fileName);
  const visit = (node: ts.Node): void => {
    if (ts.isRegularExpressionLiteral(node)) {
      const slash = node.text.lastIndexOf("/");
      const pattern = node.text.slice(1, slash), flags = node.text.slice(slash + 1);
      if (pattern.length > 32768) diagnostics.push({ message: "Regex exceeds target-validation limit (32768 characters)", severity: "error", ...locate(source, node.getStart(source)) });
      else {
        try { new RegExp(pattern, flags); } // Compile only. No matching and no user code execution.
        catch { diagnostics.push({ message: "Invalid ECMAScript regex pattern; check escapes, ranges and quantifiers", severity: "error", ...locate(source, node.getStart(source)) }); }
      }
    }
    ts.forEachChild(node, visit);
  };
  if (source) visit(source);
  return diagnostics;
}

// Also validate Rust-emitted .ts without using the TypeScript Atomis compiler.
if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 1 || !args[0].endsWith(".ts")) throw new Error("Usage: node dist/target-check.js <generated.ts>");
    const diagnostics = validateTarget(readSourceFile(args[0]), args[0]);
    for (const d of diagnostics) console.error((d.fileName ?? args[0]) + ":" + d.line + ":" + d.col + " error " + d.message);
    if (diagnostics.length) process.exitCode = 1;
    else console.log("Target check passed (ES2020, Node16 resolution, strict)");
  } catch (error) { console.error((error as Error).message); process.exitCode = 1; }
}

/** Bounded, strict UTF-8 reads for CLI source files, including growth after stat. */
import * as fs from "fs";
import { ParseError } from "./parser";
const LIMIT = 8 * 1024 * 1024;
export function readSourceFile(file: string): string {
  const fd = fs.openSync(file, "r");
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) throw new Error("Source must be a regular file");
    if (stat.size > LIMIT) throw new ParseError("Source exceeds 8 MiB limit", 1, 1);
    const bytes = Buffer.alloc(LIMIT + 1);
    let length = 0;
    while (length < bytes.length) {
      const count = fs.readSync(fd, bytes, length, bytes.length - length, null);
      if (count === 0) break;
      length += count;
    }
    if (length > LIMIT) throw new ParseError("Source exceeds 8 MiB limit", 1, 1);
    try { return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes.subarray(0, length)); }
    catch { throw new ParseError("Source must be valid UTF-8", 1, 1); }
  } finally { fs.closeSync(fd); }
}

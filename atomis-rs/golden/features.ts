/** @pure */
function classify(n: number): ({ ok: true, value: string } | { ok: false, error: Error }) {
  if (!(n >= 0)) { return { ok: false, error: new Error("negative") } }
  return { ok: true, value: "ok" }
}
function label(x: number): string {
  switch ((x) as unknown) {
    case (0): {
      return "zero"
      break;
    }
    case (1): {
      return "one"
      break;
    }
    default: {
      return "many"
      break;
    }
  }
}
let parsed: ({ ok: true, value: number } | { ok: false, error: string }) = { ok: true, value: 42 }
//# sourceMappingURL=features.ts.ato.map

/** @pure */
function classify(n: number): { ok: true, value: string } | { ok: false, error: Error } {
  if (!(n >= 0)) { return { ok: false, error: new Error("negative") } }
  return { ok: true, value: "ok" }
}
function label(x: number): string {
  if (x === 0) { "zero" }
  else if (x === 1) { "one" }
  else { "many" }
}
let parsed: { ok: true, value: number } | { ok: false, error: string } = { ok: true, value: 42 }
//# sourceMappingURL=features.ts.ato.map

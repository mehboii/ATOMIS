#!/usr/bin/env bash
# Parity harness: prove the Rust port emits byte-identical TypeScript and
# byte-identical diagnostics versus the TypeScript reference transpiler.
#
# Run from the repo root:   bash atomis-rs/parity.sh
# Requires: the TS build (`npm run build`) and the Rust release build
#           (`cargo build --release --manifest-path atomis-rs/Cargo.toml`).

set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

TS="node dist/cli.js"
RS="atomis-rs/target/release/atomis.exe"
[ -f "$RS" ] || RS="atomis-rs/target/release/atomis"

tmp="$(mktemp -d)"
pass=0; fail=0

build_cases="examples/hello examples/features examples/network \
  atomis-rs/conformance/dup atomis-rs/conformance/pure"
check_cases="examples/hello examples/features examples/network \
  atomis-rs/conformance/typemismatch atomis-rs/conformance/dup \
  atomis-rs/conformance/ghost atomis-rs/conformance/pure"

printf "%-26s | %-11s | %s\n" "program" "mode" "match"
printf -- "---------------------------+-------------+------\n"

for f in $build_cases; do
  base="$(basename "$f")"
  $TS build "$f.ato" --out "$tmp/ts" >/dev/null 2>&1
  "$RS" build "$f.ato" --out "$tmp/rs" >/dev/null 2>&1
  if diff "$tmp/ts/$base.ts" "$tmp/rs/$base.ts" >/dev/null 2>&1; then
    printf "%-26s | %-11s | Y\n" "$base.ato" "build(.ts)"; pass=$((pass+1))
  else
    printf "%-26s | %-11s | N\n" "$base.ato" "build(.ts)"; fail=$((fail+1))
  fi
done

for f in $check_cases; do
  base="$(basename "$f")"
  $TS check "$f.ato" >"$tmp/ts.txt" 2>&1
  "$RS" check "$f.ato" >"$tmp/rs.txt" 2>&1
  if diff "$tmp/ts.txt" "$tmp/rs.txt" >/dev/null 2>&1; then
    printf "%-26s | %-11s | Y\n" "$base.ato" "check(diag)"; pass=$((pass+1))
  else
    printf "%-26s | %-11s | N\n" "$base.ato" "check(diag)"; fail=$((fail+1))
  fi
done

echo
echo "TOTAL: $pass passed, $fail failed"
rm -rf "$tmp"
[ "$fail" -eq 0 ]

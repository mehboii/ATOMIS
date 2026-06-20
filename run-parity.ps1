<#
.SYNOPSIS
  Parity harness: proves the Rust ATOMIS transpiler emits BYTE-IDENTICAL
  TypeScript and BYTE-IDENTICAL diagnostics versus the TypeScript reference,
  for every example program, and runs the 29 ported Rust unit tests.

  Windows PowerShell 5.1 compatible. Source maps are out of scope (the emitted
  .ts is compared; the .ato.map companion file is not).

.USAGE
  powershell -ExecutionPolicy Bypass -File .\run-parity.ps1
#>

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

$tsCli   = "dist\cli.js"
$rustBin = "atomis-rs\target\release\atomis.exe"
$examples = @("hello", "features", "network")

# Preconditions ------------------------------------------------------------
$missing = @()
if (-not (Test-Path $tsCli))   { $missing += $tsCli }
if (-not (Test-Path $rustBin)) { $missing += $rustBin }
foreach ($e in $examples) {
  if (-not (Test-Path "examples\$e.ato")) { $missing += "examples\$e.ato" }
}
if ($missing.Count -gt 0) {
  Write-Host "STOP - missing required files:" -ForegroundColor Red
  $missing | ForEach-Object { Write-Host "  $_" -ForegroundColor Red }
  exit 2
}

# Fresh temp dir (do not assume any system temp path exists) ----------------
$tmp = Join-Path $root ".parity-tmp"
if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
New-Item -ItemType Directory -Path $tmp        | Out-Null
New-Item -ItemType Directory -Path "$tmp\ts"   | Out-Null
New-Item -ItemType Directory -Path "$tmp\rust" | Out-Null

# Helpers ------------------------------------------------------------------
function Read-Bytes([string]$p) {
  if (-not (Test-Path $p)) { return $null }
  return [System.IO.File]::ReadAllBytes((Resolve-Path $p).Path)
}
function Bytes-Equal($a, $b) {
  if ($null -eq $a -or $null -eq $b) { return $false }
  if ($a.Length -ne $b.Length) { return $false }
  for ($i = 0; $i -lt $a.Length; $i++) { if ($a[$i] -ne $b[$i]) { return $false } }
  return $true
}
function ByteLen($a) { if ($null -eq $a) { return "-" } else { return $a.Length } }
function Show-LineDiff([string]$label, [string]$tsFile, [string]$rustFile) {
  Write-Host ""
  Write-Host "  >>> DIVERGENCE in $label" -ForegroundColor Yellow
  $tsLines   = if (Test-Path $tsFile)   { Get-Content $tsFile }   else { @() }
  $rustLines = if (Test-Path $rustFile) { Get-Content $rustFile } else { @() }
  $max = [Math]::Max($tsLines.Count, $rustLines.Count)
  for ($i = 0; $i -lt $max; $i++) {
    $t = if ($i -lt $tsLines.Count)   { $tsLines[$i] }   else { "<no line>" }
    $r = if ($i -lt $rustLines.Count) { $rustLines[$i] } else { "<no line>" }
    if ($t -ne $r) {
      Write-Host ("    line {0}:" -f ($i + 1)) -ForegroundColor Yellow
      Write-Host ("      TS  : {0}" -f $t) -ForegroundColor Gray
      Write-Host ("      Rust: {0}" -f $r) -ForegroundColor Gray
    }
  }
}

# Per-example comparison ---------------------------------------------------
$rows = @()
$allMatch = $true

foreach ($name in $examples) {
  $src = "examples\$name.ato"

  # 1) Emit TypeScript via `build --out <dir>` (writes <dir>\<name>.ts).
  cmd /c "node $tsCli build $src --out `"$tmp\ts`" > NUL 2>&1"
  cmd /c "`"$rustBin`" build $src --out `"$tmp\rust`" > NUL 2>&1"
  $tsTs   = "$tmp\ts_$name.ts"
  $rustTs = "$tmp\rust_$name.ts"
  if (Test-Path "$tmp\ts\$name.ts")   { Copy-Item "$tmp\ts\$name.ts"   $tsTs   -Force }
  if (Test-Path "$tmp\rust\$name.ts") { Copy-Item "$tmp\rust\$name.ts" $rustTs -Force }

  # 2) Capture diagnostics via `check` (stdout + stderr merged).
  $tsDiag   = "$tmp\ts_$name.diag"
  $rustDiag = "$tmp\rust_$name.diag"
  cmd /c "node $tsCli check $src > `"$tsDiag`" 2>&1"
  cmd /c "`"$rustBin`" check $src > `"$rustDiag`" 2>&1"

  # 3) Byte-compare both artifacts.
  $tsTsBytes   = Read-Bytes $tsTs
  $rustTsBytes = Read-Bytes $rustTs
  $tsDiagBytes   = Read-Bytes $tsDiag
  $rustDiagBytes = Read-Bytes $rustDiag

  $tsMatch   = Bytes-Equal $tsTsBytes   $rustTsBytes
  $diagMatch = Bytes-Equal $tsDiagBytes $rustDiagBytes
  if (-not $tsMatch -or -not $diagMatch) { $allMatch = $false }

  $rows += [PSCustomObject]@{
    Item        = "$name.ato"
    TsTs        = ByteLen $tsTsBytes
    RustTs      = ByteLen $rustTsBytes
    TsMatch     = $(if ($tsMatch) { "Y" } else { "N" })
    DiagMatch   = $(if ($diagMatch) { "Y" } else { "N" })
  }

  if (-not $tsMatch)   { Show-LineDiff "$name.ts (emitted TypeScript)" $tsTs $rustTs }
  if (-not $diagMatch) { Show-LineDiff "$name diagnostics"            $tsDiag $rustDiag }
}

# 4) Rust unit tests (ports of lexer.test.ts + parser.test.ts) -------------
$ctOut = "$tmp\cargo-test.txt"
cmd /c "cargo test --manifest-path atomis-rs\Cargo.toml > `"$ctOut`" 2>&1"
$ctText = Get-Content $ctOut -Raw
$passed = 0
[regex]::Matches($ctText, '(\d+) passed') | ForEach-Object { $passed += [int]$_.Groups[1].Value }
$failed = 0
[regex]::Matches($ctText, '(\d+) failed') | ForEach-Object { $failed += [int]$_.Groups[1].Value }
$testsOk = ($failed -eq 0 -and $passed -ge 29)

# 5) Console table ---------------------------------------------------------
Write-Host ""
Write-Host "ATOMIS Rust-vs-TS parity" -ForegroundColor Cyan
$fmt = "{0,-14} | {1,8} | {2,8} | {3,9} | {4,17}"
Write-Host ($fmt -f "Item", "TS .ts", "Rust .ts", ".ts match", "diagnostics match")
Write-Host ("-" * 70)
foreach ($r in $rows) {
  Write-Host ($fmt -f $r.Item, $r.TsTs, $r.RustTs, $r.TsMatch, $r.DiagMatch)
}
Write-Host ("-" * 70)
Write-Host ("cargo test (ported unit tests): {0}/29 passing ({1} failed)" -f $passed, $failed)

$verdict = if ($allMatch -and $testsOk) {
  "FULL PARITY: byte-identical .ts and diagnostics on all examples; unit tests green."
} else {
  "NOT AT PARITY: see divergences above."
}
$verdictColor = if ($allMatch -and $testsOk) { "Green" } else { "Red" }
Write-Host ""
Write-Host "VERDICT: $verdict" -ForegroundColor $verdictColor

# 6) PARITY.md -------------------------------------------------------------
$md = @()
$md += "# ATOMIS - Rust vs TypeScript parity report"
$md += ""
$md += "Generated by ``run-parity.ps1`` on $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')."
$md += ""
$md += "Compares the Rust port (``$rustBin``) against the TypeScript reference"
$md += "(``node $tsCli``). Both artifacts are compared **byte for byte**:"
$md += "the emitted ``.ts`` (from ``build``) and the diagnostics (from ``check``)."
$md += "Source maps (``.ato.map`` / VLQ) are out of scope."
$md += ""
$md += "| Item | TS .ts | Rust .ts | .ts match | diagnostics match |"
$md += "|------|-------:|---------:|:---------:|:-----------------:|"
foreach ($r in $rows) {
  $md += "| $($r.Item) | $($r.TsTs) | $($r.RustTs) | $($r.TsMatch) | $($r.DiagMatch) |"
}
$md += "| **cargo test** | | | \- | **$passed/29 passing ($failed failed)** |"
$md += ""
$md += "**Verdict:** $verdict"
$md | Set-Content -Path "$root\PARITY.md" -Encoding UTF8

Write-Host ""
Write-Host "Wrote PARITY.md" -ForegroundColor Cyan

if ($allMatch -and $testsOk) { exit 0 } else { exit 1 }

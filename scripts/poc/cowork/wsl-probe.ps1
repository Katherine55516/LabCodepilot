<#
  wsl-probe.ps1 — Cowork P2 / W0 channel POC (step 1: channel floor only)

  Verifies the three load-bearing assumptions of the `wsl.exe -e` stdio channel,
  with ZERO dependency on claude / credentials / the cowork daemon:

    A. Binary transparency — is `wsl.exe -e` stdin/stdout a clean byte pipe?
       (no LF->CRLF, no UTF-16 / BOM, no encoding mangling)
    B. EOF half-close (#4424) — when the host closes wsl.exe's stdin (without
       killing it), does the Linux process see a clean EOF at a frame boundary?
    C. Streaming — does the guest echo frame-by-frame, or buffer until close?

  How it works: spawns `wsl.exe -d <distro> -e python3 /tmp/wslprobe.py`, grabs
  the RAW stdio byte streams via System.Diagnostics.Process (same shape as a
  future Node child_process.spawn), sends length-prefixed frames, and diffs the
  echo byte-for-byte. All diagnostics print in English so the report pastes back
  cleanly regardless of console codepage.

  Run:
    powershell -ExecutionPolicy Bypass -File .\wsl-probe.ps1
    powershell -ExecutionPolicy Bypass -File .\wsl-probe.ps1 -Distro Debian

  Then copy the whole ===== WSL-PROBE REPORT ===== block back.

  NOTE: authored on macOS with no Windows to pre-run against — if any step
  errors, paste the error verbatim; expect 1-2 iteration rounds. That is exactly
  what W0 ("biggest unknown, go first") is for.
#>

param(
    [string]$Distro = "",
    [switch]$AsRoot   # future prod path uses -u root; off by default to cut failure surface
)

$ErrorActionPreference = "Stop"
$PROBE_SCRIPT_VERSION = 2

function Say([string]$m) { Write-Host "[probe] $m" }
function HexPreview([byte[]]$b, [int]$n) {
    if ($null -eq $b -or $b.Length -eq 0) { return "(empty)" }
    $m = [Math]::Min($n, $b.Length)
    $sb = New-Object System.Text.StringBuilder
    for ($i = 0; $i -lt $m; $i++) { [void]$sb.Append(('{0:x2} ' -f $b[$i])) }
    return $sb.ToString().Trim()
}

# Decode wsl.exe CLI output. Older in-box WSL emits UTF-16LE (the WSL_UTF8 env var
# is unsupported there); newer Store WSL emits UTF-8. Sniff null-byte density to pick.
function Decode-Wsl([byte[]]$bytes) {
    if (-not $bytes -or $bytes.Length -eq 0) { return "" }
    $sample = [Math]::Min(200, $bytes.Length); $nulls = 0
    for ($i = 0; $i -lt $sample; $i++) { if ($bytes[$i] -eq 0) { $nulls++ } }
    if ($nulls -gt ($sample / 4)) { return ([Text.Encoding]::Unicode.GetString($bytes)).Trim() }
    $s = [Text.Encoding]::UTF8.GetString($bytes)
    if ($s.Length -gt 0 -and $s[0] -eq [char]0xFEFF) { $s = $s.Substring(1) }  # strip BOM
    return $s.Trim()
}
# Run a wsl.exe MANAGEMENT command (--version / -l -v / -l -q): capture raw bytes so
# native stderr never trips $ErrorActionPreference='Stop', and decode robustly.
function Wsl([string]$argLine) {
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = "wsl.exe"; $psi.Arguments = $argLine
    $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true
    $psi.UseShellExecute = $false
    try { $p = [System.Diagnostics.Process]::Start($psi) }
    catch { return [PSCustomObject]@{ ExitCode = -1; Out = ""; Err = "spawn failed: $_" } }
    $mo = New-Object System.IO.MemoryStream; $p.StandardOutput.BaseStream.CopyTo($mo)
    $me = New-Object System.IO.MemoryStream; $p.StandardError.BaseStream.CopyTo($me)
    $p.WaitForExit()
    return [PSCustomObject]@{ ExitCode = $p.ExitCode; Out = (Decode-Wsl $mo.ToArray()); Err = (Decode-Wsl $me.ToArray()) }
}
# Run a wsl.exe -e GUEST command: args as an array (no quote juggling), stderr non-fatal.
# Guest stdout is a raw pipe (not the wsl CLI encoding layer), so & capture is fine.
function WslExec([string[]]$rest) {
    $eap = $ErrorActionPreference; $ErrorActionPreference = "Continue"
    try { return ((& wsl.exe @rest 2>&1 | Out-String).Trim()) } finally { $ErrorActionPreference = $eap }
}

# ---------------------------------------------------------------------------
# 0. Environment self-check
# ---------------------------------------------------------------------------
Say "wsl-probe version $PROBE_SCRIPT_VERSION"

$verR = Wsl "--version"
if ($verR.ExitCode -eq 0 -and $verR.Out) { $wslVersion = $verR.Out } else { $wslVersion = "(older in-box WSL; --version unsupported)" }
Say "wsl --version:`n$wslVersion"

$lvR = Wsl "-l -v"
Say "wsl -l -v:`n$($lvR.Out)$($lvR.Err)"

if ([string]::IsNullOrWhiteSpace($Distro)) {
    $lqR = Wsl "-l -q"
    $names = @()
    foreach ($line in ($lqR.Out -split "`r?`n")) { $t = $line.Trim(); if ($t) { $names += $t } }
    if ($names.Count -eq 0) {
        Say "No installed WSL distro found (the message above is WSL's standard 'no distributions installed')."
        Say "Fix: run   wsl --install -d Ubuntu   (first setup needs a reboot); finish the Ubuntu"
        Say "     username/password prompt, then re-run this script."
        Say "If 'wsl --install' fails on this older build: run   wsl --update   first, or install"
        Say "     'Ubuntu' (or 'Debian') from the Microsoft Store, then re-run."
        exit 2
    }
    $Distro = $names[0]
    Say "Auto-selected distro: $Distro  (override with -Distro <name>)"
} else {
    Say "Using distro: $Distro"
}

# python3 present?
$py = WslExec @("-d", $Distro, "-e", "python3", "--version")
if ($py -notmatch "Python 3") {
    Say "python3 not found in '$Distro' (got: '$py')."
    Say "Fix: wsl -d $Distro -e sudo apt-get update; wsl -d $Distro -e sudo apt-get install -y python3"
    exit 3
}
Say "guest python3: $py"

$whoami = WslExec @("-d", $Distro, "-e", "id")
Say "guest id: $whoami"

# ---------------------------------------------------------------------------
# 1. Write the Python probe into the distro (base64 to dodge any quoting/CRLF)
# ---------------------------------------------------------------------------
$probePy = @'
import sys, os, struct, json
inb = sys.stdin.buffer
out = sys.stdout.buffer

def rx(n):
    b = b''
    while len(b) < n:
        c = inb.read(n - len(b))
        if not c:
            return b
        b += c
    return b

frames = 0
total = 0
first_hdr = b''
preview = b''
reason = 'UNKNOWN'
while True:
    h = rx(4)
    if len(h) == 0:
        reason = 'STDIN_EOF'          # clean EOF at frame boundary == #4424 works
        break
    if len(h) < 4:
        reason = 'PARTIAL_HEADER'     # torn header -> pipe not transparent
        first_hdr = h
        break
    if not first_hdr:
        first_hdr = h
    (L,) = struct.unpack('>I', h)
    if L == 0:
        reason = 'EXPLICIT_ZERO'      # explicit end marker (macOS frame protocol)
        break
    p = rx(L)
    if len(preview) < 32:
        preview = (preview + p)[:32]
    if len(p) < L:
        reason = 'PARTIAL_BODY'       # torn payload (abort scenario)
        break
    out.write(h)
    out.write(p)
    out.flush()                       # stream immediately, do not buffer to EOF
    frames += 1
    total += L

diag = {
    'py': sys.version.split()[0],
    'uid': os.getuid(),
    'frames': frames,
    'bytes': total,
    'first_hdr_hex': first_hdr.hex(),
    'recv_preview_hex': preview.hex(),
    'end_reason': reason,
}
sys.stderr.write(json.dumps(diag) + '\n')
sys.stderr.flush()
'@

$b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($probePy))
$writeCmd = "echo '$b64' | base64 -d > /tmp/wslprobe.py && wc -c /tmp/wslprobe.py && echo WROTE_OK"
$w = WslExec @("-d", $Distro, "-e", "bash", "-c", $writeCmd)
Say "probe upload: $w"
if ($w -notmatch "WROTE_OK") {
    Say "Could not write probe into distro. Aborting."
    exit 4
}

# ---------------------------------------------------------------------------
# 2. Spawn wsl.exe with the probe, grab RAW stdio byte streams
# ---------------------------------------------------------------------------
$userArg = ""
if ($AsRoot) { $userArg = "-u root " }

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = "wsl.exe"
$psi.Arguments = "-d `"$Distro`" $userArg-e python3 /tmp/wslprobe.py"
$psi.RedirectStandardInput = $true
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$psi.UseShellExecute = $false
$psi.StandardErrorEncoding = [Text.Encoding]::UTF8

Say "spawning: wsl.exe $($psi.Arguments)"
$proc = [System.Diagnostics.Process]::Start($psi)
$sin = $proc.StandardInput.BaseStream
$sout = $proc.StandardOutput.BaseStream

# ---------------------------------------------------------------------------
# 3. Build frames: cover the full byte spectrum + newline combos + big + tiny
# ---------------------------------------------------------------------------
$f1 = [byte[]](0..255)                                               # every byte 0x00-0xFF
$f2 = [Text.Encoding]::ASCII.GetBytes("line1`nline2`r`nline3`rEND")  # LF / CRLF / CR
$f3 = New-Object byte[] 8192                                          # big frame (chunked streaming)
for ($i = 0; $i -lt 8192; $i++) { $f3[$i] = [byte]($i % 256) }
$f4 = [byte[]](0x00)                                                  # 1-byte frame
$payloads = @($f1, $f2, $f3, $f4)

$expected = 0
foreach ($p in $payloads) { $expected += 4 + $p.Length }
Say "sending frames=$($payloads.Count) expected_echo_bytes=$expected"

# concatenate all frames, then WriteAsync concurrently with reading (avoid pipe deadlock)
$ms = New-Object System.IO.MemoryStream
foreach ($p in $payloads) {
    $h = [BitConverter]::GetBytes([int]$p.Length)
    if ([BitConverter]::IsLittleEndian) { [Array]::Reverse($h) }   # big-endian length prefix
    $ms.Write($h, 0, 4)
    $ms.Write($p, 0, $p.Length)
}
$allBytes = $ms.ToArray()
$wtask = $sin.WriteAsync($allBytes, 0, $allBytes.Length)

# ---------------------------------------------------------------------------
# 4. Phase 1 — read echo BEFORE closing stdin (streaming test)
# ---------------------------------------------------------------------------
$buf = New-Object byte[] $expected
$got = 0
function ReadUpTo([int]$targetTotal, [int]$overallMs) {
    $deadline = [DateTime]::UtcNow.AddMilliseconds($overallMs)
    while ($script:got -lt $targetTotal) {
        $remain = $targetTotal - $script:got
        $t = $sout.ReadAsync($buf, $script:got, $remain)
        $sliceMs = [int]([Math]::Max(300, ($deadline - [DateTime]::UtcNow).TotalMilliseconds))
        if (-not $t.Wait($sliceMs)) { return $false }   # timed out
        $n = $t.Result
        if ($n -le 0) { return $false }                 # stream closed early
        $script:got += $n
        if ([DateTime]::UtcNow -gt $deadline) { return $false }
    }
    return $true
}

$streamedOk = ReadUpTo $expected 5000
$preCloseGot = $got

# ---------------------------------------------------------------------------
# 5. Close stdin (EOF half-close test), then Phase 2 — read any remainder
# ---------------------------------------------------------------------------
try { [void]$wtask.Wait(3000) } catch {}
$sin.Flush()
$sin.Close()

if (-not $streamedOk) { [void](ReadUpTo $expected 5000) }   # buffered guest would deliver only after close

$exited = $proc.WaitForExit(6000)
$errText = $proc.StandardError.ReadToEnd()
$exitCode = if ($exited) { $proc.ExitCode } else { "(still running / timeout)" }
if (-not $exited) { try { $proc.Kill() } catch {} }

# ---------------------------------------------------------------------------
# 6. Byte-exact comparison
# ---------------------------------------------------------------------------
$byteExact = $true
$mismatchInfo = ""
if ($got -lt $expected) {
    $byteExact = $false
    $mismatchInfo = "short read: got=$got expected=$expected"
} else {
    $off = 0
    foreach ($p in $payloads) {
        $L = ([int]$buf[$off] -shl 24) -bor ([int]$buf[$off + 1] -shl 16) -bor ([int]$buf[$off + 2] -shl 8) -bor [int]$buf[$off + 3]
        $off += 4
        if ($L -ne $p.Length) {
            $byteExact = $false
            $mismatchInfo = "frame len mismatch: hdr says $L, sent $($p.Length)"
            break
        }
        for ($i = 0; $i -lt $L; $i++) {
            if ($buf[$off + $i] -ne $p[$i]) {
                $byteExact = $false
                $mismatchInfo = "byte mismatch at frame offset $i (sent 0x{0:x2}, got 0x{1:x2})" -f $p[$i], $buf[$off + $i]
                break
            }
        }
        $off += $L
        if (-not $byteExact) { break }
    }
}

# streaming verdict: echo fully arrived BEFORE we closed stdin
$streamVerdict = if ($preCloseGot -ge $expected) { "PASS (echo arrived before stdin close)" }
                 elseif ($got -ge $expected) { "BUFFERED (only after stdin close: preClose=$preCloseGot)" }
                 else { "INCONCLUSIVE (never read full echo)" }

# ---------------------------------------------------------------------------
# 7. Report
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "===== WSL-PROBE REPORT ====="
Write-Host "script_version : $PROBE_SCRIPT_VERSION"
Write-Host "distro         : $Distro"
Write-Host "as_root        : $($AsRoot.IsPresent)"
Write-Host "guest_python   : $py"
Write-Host "guest_id       : $whoami"
Write-Host "wsl_version    : $($wslVersion -replace "`r?`n",' | ')"
Write-Host "--- A. binary transparency ---"
Write-Host "byte_exact     : $(if ($byteExact){'PASS'}else{'FAIL'})   $mismatchInfo"
Write-Host "sent_bytes     : $expected   recv_bytes: $got"
Write-Host "host_recv_hex  : $(HexPreview $buf 64)"
Write-Host "--- B. EOF half-close (#4424) ---"
Write-Host "process_exited : $exited   exit_code: $exitCode"
Write-Host "guest_diag     : $($errText.Trim())"
Write-Host "  (want end_reason=STDIN_EOF, frames=4, bytes=8471, exit_code=0)"
Write-Host "--- C. streaming ---"
Write-Host "stream_verdict : $streamVerdict"
Write-Host "preClose_bytes : $preCloseGot / $expected"
Write-Host "===== END REPORT ====="
Write-Host ""
Say "done. Copy the whole REPORT block above back."

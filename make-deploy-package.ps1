# =============================================================================
# QAASR - Make Deployment Package
# Run from the project root:  .\make-deploy-package.ps1
#
# What it does:
#   1. Recreates prod-deploy/ with the required folder structure
#   2. Copies config files (docker-compose.yml, nginx.conf, .env.example)
#   3. Dumps the live PostgreSQL database
#   4. Exports all named volumes (scripts, data, pgdata)
#   5. Saves all five Docker images as .tar files
#   6. Writes a bundle manifest (manifest.txt)
#
# Prerequisites:
#   - Docker Desktop running
#   - All QAASR containers running (docker compose up -d)
#   - Run from the qa-automation-suite-runner project root
# =============================================================================

$ErrorActionPreference = "Stop"

function info  { param($m) Write-Host "  [INFO]  $m" -ForegroundColor Cyan    }
function ok    { param($m) Write-Host "  [OK]    $m" -ForegroundColor Green   }
function warn  { param($m) Write-Host "  [WARN]  $m" -ForegroundColor Yellow  }
function die   { param($m) Write-Host "  [FAIL]  $m" -ForegroundColor Red; exit 1 }
function step  { param($m) Write-Host "`n==> $m" -ForegroundColor Magenta     }

$root       = $PSScriptRoot
$dest       = Join-Path $root "prod-deploy"
$destDocker = $dest -replace '\\','/'
$ts         = Get-Date -Format "yyyy-MM-dd HH:mm"

Write-Host ""
Write-Host "  QAASR Deployment Package Builder" -ForegroundColor White
Write-Host "  $ts" -ForegroundColor DarkGray
Write-Host ""

# -----------------------------------------------------------------------------
step "Pre-flight checks"

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    die "Docker not found in PATH"
}
$null = docker info 2>&1
if ($LASTEXITCODE -ne 0) { die "Docker daemon is not running" }

$required = @("qaasr-postgres","qaasr-api","qaasr-runner","qaasr-ui","qaasr-redis")
foreach ($c in $required) {
    $st = docker inspect --format="{{.State.Status}}" $c 2>$null
    if ($st -ne "running") {
        die "Container $c is not running. Run 'docker compose up -d' first."
    }
}
ok "All containers running"

# Detect active compose project prefix for volume names
$volPrefix = "qa-automation-suite-runner"
$testVol   = "${volPrefix}_qaasr-scripts"
$volCheck  = docker volume ls --format "{{.Name}}" | Select-String $testVol -Quiet
if (-not $volCheck) {
    $volPrefix = "qaasr"
    $testVol2  = "${volPrefix}_qaasr-scripts"
    $volCheck2 = docker volume ls --format "{{.Name}}" | Select-String $testVol2 -Quiet
    if (-not $volCheck2) {
        die "Cannot find qaasr volumes. Expected prefix 'qa-automation-suite-runner' or 'qaasr'."
    }
}
ok "Volume prefix detected: $volPrefix"

# -----------------------------------------------------------------------------
step "Creating prod-deploy/ folder structure"

# Back up restore.sh before wiping the folder
$restoreBackup = $null
if (Test-Path "$dest\restore.sh") {
    $restoreBackup = [System.IO.Path]::GetTempFileName()
    Copy-Item "$dest\restore.sh" $restoreBackup
}

if (Test-Path $dest) {
    warn "prod-deploy/ already exists - wiping and recreating"
    Remove-Item -Recurse -Force $dest
}

New-Item -ItemType Directory -Force "$dest\images"       | Out-Null
New-Item -ItemType Directory -Force "$dest\volumes"      | Out-Null
New-Item -ItemType Directory -Force "$dest\db"           | Out-Null
New-Item -ItemType Directory -Force "$dest\config\nginx" | Out-Null

# Restore restore.sh after wipe
if ($restoreBackup -and (Test-Path $restoreBackup)) {
    Copy-Item $restoreBackup "$dest\restore.sh"
    Remove-Item $restoreBackup
    ok "restore.sh preserved"
}
ok "Folders ready"

# -----------------------------------------------------------------------------
step "Copying config files"

Copy-Item "$root\docker-compose.yml"          "$dest\config\docker-compose.yml"
Copy-Item "$root\.env.example"               "$dest\config\.env.example"
Copy-Item "$root\nginx\nginx.conf"           "$dest\config\nginx\nginx.conf"
Copy-Item "$root\gen-compose-override.sh"    "$dest\gen-compose-override.sh"
ok "docker-compose.yml, .env.example, nginx.conf, gen-compose-override.sh copied"

# -----------------------------------------------------------------------------
step "Dumping PostgreSQL database"

info "Running pg_dumpall inside qaasr-postgres..."
$dumpFile = "$dest\db\full-dump.sql"
docker exec qaasr-postgres sh -c 'pg_dumpall -U "$POSTGRES_USER"' | Out-File -FilePath $dumpFile -Encoding utf8
if ($LASTEXITCODE -ne 0) { die "pg_dumpall failed" }
$dumpLines = (Get-Content $dumpFile | Measure-Object -Line).Lines
ok "Database dumped - $dumpLines lines"

# -----------------------------------------------------------------------------
step "Exporting Docker volumes"

$volumes = @(
    [PSCustomObject]@{ vol = "${volPrefix}_qaasr-scripts"; file = "scripts.tar.gz"; label = "Scripts and resources" },
    [PSCustomObject]@{ vol = "${volPrefix}_qaasr-data";    file = "data.tar.gz";    label = "App data"             },
    [PSCustomObject]@{ vol = "${volPrefix}_qaasr-pgdata";  file = "pgdata.tar.gz";  label = "Postgres data dir"    }
)

foreach ($v in $volumes) {
    info "Exporting $($v.label) ($($v.vol))..."
    docker run --rm `
        -v "$($v.vol):/source:ro" `
        -v "${destDocker}/volumes:/backup" `
        alpine sh -c "cd /source && tar czf /backup/$($v.file) . && echo done"
    if ($LASTEXITCODE -ne 0) { die "Volume export failed for $($v.vol)" }
    $sz = [math]::Round((Get-Item "$dest\volumes\$($v.file)").Length / 1MB, 1)
    ok "$($v.file) - $sz MB"
}

# -----------------------------------------------------------------------------
step "Saving Docker images (slow step - approx 4 GB total)"

$images = @(
    [PSCustomObject]@{ tag = "qaasr-api:latest";    file = "qaasr-api.tar"    },
    [PSCustomObject]@{ tag = "qaasr-ui:latest";     file = "qaasr-ui.tar"     },
    [PSCustomObject]@{ tag = "qaasr-runner:latest"; file = "qaasr-runner.tar" },
    [PSCustomObject]@{ tag = "postgres:16-alpine";  file = "postgres-16.tar"  },
    [PSCustomObject]@{ tag = "redis:7-alpine";      file = "redis-7.tar"      }
)

foreach ($img in $images) {
    $out = "$dest\images\$($img.file)"
    info "Saving $($img.tag)..."
    docker save $img.tag -o $out
    if ($LASTEXITCODE -ne 0) { die "docker save failed for $($img.tag)" }
    $sz = [math]::Round((Get-Item $out).Length / 1MB, 0)
    ok "$($img.file) - $sz MB"
}

# -----------------------------------------------------------------------------
step "Writing manifest"

$totalBytes = (Get-ChildItem $dest -Recurse -File | Measure-Object -Property Length -Sum).Sum
$totalMB    = [math]::Round($totalBytes / 1MB, 0)
$fileList   = Get-ChildItem $dest -Recurse -File | ForEach-Object {
    $rel  = $_.FullName.Replace($dest, '').TrimStart('\')
    $kb   = [math]::Round($_.Length / 1KB, 0)
    "  $rel  ($kb KB)"
}

@"
QAASR Deployment Package Manifest
Generated  : $ts
Total size : $totalMB MB

Files:
$($fileList -join "`n")

Source volume prefix : $volPrefix
Docker images saved  : $($images.Count)
DB dump lines        : $dumpLines

Restore instructions:
  1. SCP this folder to the target Linux server
  2. cd prod-deploy
  3. cp config/.env.example config/.env  and fill in all secrets
  4. chmod +x restore.sh
  5. sudo ./restore.sh
"@ | Out-File -FilePath "$dest\manifest.txt" -Encoding utf8

ok "manifest.txt written"

# -----------------------------------------------------------------------------
Write-Host ""
Write-Host "  Package complete!" -ForegroundColor Green
Write-Host "  Location : $dest" -ForegroundColor White
Write-Host "  Size     : $totalMB MB" -ForegroundColor White
Write-Host ""
Write-Host "  Next steps:" -ForegroundColor DarkGray
Write-Host "    1. SCP prod-deploy/ to the target server" -ForegroundColor DarkGray
Write-Host "    2. cd prod-deploy and run: sudo ./restore.sh" -ForegroundColor DarkGray
Write-Host ""

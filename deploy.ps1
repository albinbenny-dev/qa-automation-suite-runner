# ==============================================================================
# QAASR Deploy Script
# Usage:
#   .\deploy.ps1                      # release build only
#   .\deploy.ps1 -Mode full           # release + DB migration + volumes
#   .\deploy.ps1 -SSH qa-server       # override SSH alias
# ==============================================================================

param(
    [ValidateSet('release', 'full')]
    [string]$Mode = 'release',
    [string]$SSH  = 'qa-server',
    [string]$RemoteDir = '/data/autoab/qa-automation-suite-runner'
)

$ErrorActionPreference = 'Stop'
$ProjectName = 'qa-automation-suite-runner'
$TmpDir      = "$PSScriptRoot\.deploy-tmp"

# -- Helpers -------------------------------------------------------------------
function Log-Step  { param($msg) Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Log-Ok    { param($msg) Write-Host "    [OK] $msg" -ForegroundColor Green }
function Log-Warn  { param($msg) Write-Host "    [!!] $msg" -ForegroundColor Yellow }
function Log-Error { param($msg) Write-Host "    [ERR] $msg" -ForegroundColor Red; exit 1 }

function Run-SSH {
    param([string]$cmd)
    ssh $SSH $cmd
    if ($LASTEXITCODE -ne 0) { Log-Error "Remote command failed: $cmd" }
}

function Run-SCP {
    param([string]$local, [string]$remote)
    scp $local "${SSH}:${remote}"
    if ($LASTEXITCODE -ne 0) { Log-Error "SCP failed: $local -> $remote" }
}

# -- Banner --------------------------------------------------------------------
Write-Host ""
Write-Host "  QAASR Deploy" -ForegroundColor DarkCyan
Write-Host "  Mode   : $Mode" -ForegroundColor White
Write-Host "  Target : $SSH  ->  $RemoteDir" -ForegroundColor White
Write-Host ""

if ($Mode -eq 'full') {
    Log-Warn "FULL MIGRATION mode - this will stop services, restore DB and volumes."
    $confirm = Read-Host "  Type YES to continue"
    if ($confirm -ne 'YES') { Write-Host "Aborted." -ForegroundColor Yellow; exit 0 }
}

# -- Temp dir ------------------------------------------------------------------
New-Item -ItemType Directory -Force -Path $TmpDir | Out-Null

# ==============================================================================
# PHASE 1 - Build images
# ==============================================================================
Log-Step "Building Docker images"

Push-Location $PSScriptRoot
docker compose -p $ProjectName build qaasr-api qaasr-ui qaasr-runner
if ($LASTEXITCODE -ne 0) { Log-Error "Docker build failed" }
Log-Ok "Images built"

# ==============================================================================
# PHASE 2 - Save images to tars
# ==============================================================================
Log-Step "Saving images to tar files"

$images = @(
    @{ name = 'qaasr-api';    tar = "$TmpDir\qaasr-api.tar" },
    @{ name = 'qaasr-ui';     tar = "$TmpDir\qaasr-ui.tar"  },
    @{ name = 'qaasr-runner'; tar = "$TmpDir\qaasr-runner.tar" }
)

foreach ($img in $images) {
    Write-Host "    Saving $($img.name)..." -NoNewline
    docker save "$($img.name):latest" -o $img.tar
    if ($LASTEXITCODE -ne 0) { Log-Error "docker save failed for $($img.name)" }
    $sizeMB = [math]::Round((Get-Item $img.tar).Length / 1MB, 1)
    Write-Host " $sizeMB MB" -ForegroundColor Gray
}
Log-Ok "All images saved"

# ==============================================================================
# PHASE 3 - Full migration: dump DB + scripts volume (full mode only)
# ==============================================================================
if ($Mode -eq 'full') {
    Log-Step "Dumping PostgreSQL database from local container"

    docker exec qaasr-postgres pg_dump -U qasr qasr -f /tmp/qasr-dump.sql
    if ($LASTEXITCODE -ne 0) { Log-Error "pg_dump failed" }
    docker cp qaasr-postgres:/tmp/qasr-dump.sql "$TmpDir\qasr-dump.sql"
    if ($LASTEXITCODE -ne 0) { Log-Error "docker cp dump failed" }
    Log-Ok "DB dump saved"

    Log-Step "Exporting scripts volume"
    docker run --rm `
        -v qa-automation-suite-runner_qaasr-scripts:/scripts:ro `
        -v "${TmpDir}:/backup" `
        alpine tar -czf /backup/qaasr-scripts.tar.gz -C /scripts .
    if ($LASTEXITCODE -ne 0) { Log-Error "Scripts volume export failed" }
    Log-Ok "Scripts volume exported"
}

# ==============================================================================
# PHASE 4 - Copy config files
# ==============================================================================
Log-Step "Copying config files to tmp"

Copy-Item "$PSScriptRoot\docker-compose.yml" "$TmpDir\docker-compose.yml" -Force
Copy-Item "$PSScriptRoot\.env"               "$TmpDir\.env"               -Force
if (Test-Path "$PSScriptRoot\nginx\nginx.conf") {
    New-Item -ItemType Directory -Force -Path "$TmpDir\nginx" | Out-Null
    Copy-Item "$PSScriptRoot\nginx\nginx.conf" "$TmpDir\nginx\nginx.conf" -Force
}
Log-Ok "Config files ready"

# ==============================================================================
# PHASE 5 - Transfer to remote server
# ==============================================================================
Log-Step "Transferring files to $SSH"

Run-SSH "mkdir -p $RemoteDir"

foreach ($img in $images) {
    $remotePath = "$RemoteDir/$(Split-Path $img.tar -Leaf)"
    Write-Host "    Uploading $(Split-Path $img.tar -Leaf)..." -NoNewline
    Run-SCP $img.tar $remotePath
    Write-Host " done" -ForegroundColor Gray
}

Run-SCP "$TmpDir\docker-compose.yml" "$RemoteDir/docker-compose.yml"
Run-SCP "$TmpDir\.env"               "$RemoteDir/.env"

if (Test-Path "$TmpDir\nginx\nginx.conf") {
    Run-SSH "mkdir -p $RemoteDir/nginx"
    Run-SCP "$TmpDir\nginx\nginx.conf" "$RemoteDir/nginx/nginx.conf"
}

if ($Mode -eq 'full') {
    Run-SCP "$TmpDir\qasr-dump.sql"         "$RemoteDir/qasr-dump.sql"
    Run-SCP "$TmpDir\qaasr-scripts.tar.gz"  "$RemoteDir/qaasr-scripts.tar.gz"
}

Log-Ok "All files transferred"

# ==============================================================================
# PHASE 6 - Load images and restart on remote
# ==============================================================================
Log-Step "Loading images on remote server"

foreach ($img in $images) {
    $tarName = Split-Path $img.tar -Leaf
    Write-Host "    Loading $tarName..." -NoNewline
    Run-SSH "sudo docker load -i $RemoteDir/$tarName"
    Write-Host " done" -ForegroundColor Gray
}
Log-Ok "Images loaded"

if ($Mode -eq 'full') {
    Log-Step "Stopping services for full migration"
    Run-SSH "cd $RemoteDir && sudo docker-compose -p $ProjectName stop qaasr-api qaasr-runner"

    Log-Step "Restoring database"
    Run-SSH "sudo docker exec qaasr-postgres psql -U qasr -c 'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=''qasr'' AND pid <> pg_backend_pid();'"
    Run-SSH "sudo docker exec qaasr-postgres psql -U qasr -c 'DROP DATABASE IF EXISTS qasr;'"
    Run-SSH "sudo docker exec qaasr-postgres psql -U qasr -c 'CREATE DATABASE qasr;'"
    Run-SSH "sudo docker cp $RemoteDir/qasr-dump.sql qaasr-postgres:/tmp/qasr-dump.sql"
    Run-SSH "sudo docker exec qaasr-postgres psql -U qasr -d qasr -f /tmp/qasr-dump.sql"
    Log-Ok "Database restored"

    Log-Step "Restoring scripts volume"
    $volCmd = "sudo docker run --rm -v qa-automation-suite-runner_qaasr-scripts:/scripts -v ${RemoteDir}:/backup:ro alpine sh -c 'rm -rf /scripts/* && tar -xzf /backup/qaasr-scripts.tar.gz -C /scripts'"
    Run-SSH $volCmd
    Log-Ok "Scripts volume restored"

    Log-Step "Starting all services"
    Run-SSH "cd $RemoteDir && sudo docker-compose -p $ProjectName up -d --no-build"
} else {
    Log-Step "Rolling restart on remote"
    Run-SSH "cd $RemoteDir && sudo docker-compose -p $ProjectName up -d --no-build"
}

Log-Ok "Services restarted"

# ==============================================================================
# PHASE 7 - Health check
# ==============================================================================
Log-Step "Waiting for API health check"

$healthy = $false
for ($i = 1; $i -le 20; $i++) {
    Start-Sleep -Seconds 5
    $result = ssh $SSH "curl -sf http://localhost:4000/health 2>/dev/null && echo OK || echo FAIL"
    if ($result -match 'OK') { $healthy = $true; break }
    Write-Host "    Waiting... ($($i * 5)s)" -ForegroundColor Gray
}

if ($healthy) {
    Log-Ok "API is healthy"
} else {
    Log-Warn "API health check timed out - check logs with:"
    Write-Host "    ssh $SSH 'sudo docker logs qaasr-api --tail 50'" -ForegroundColor Yellow
}

# ==============================================================================
# PHASE 8 - Disk usage
# ==============================================================================
Log-Step "Remote disk usage"
Run-SSH "df -h /data"

# -- Cleanup -------------------------------------------------------------------
Log-Step "Cleaning up local temp files"
Remove-Item -Recurse -Force $TmpDir
Log-Ok "Done"

Pop-Location

Write-Host ""
Write-Host "  Deployment complete!" -ForegroundColor Green
Write-Host "  Mode   : $Mode" -ForegroundColor White
Write-Host "  Target : $SSH -> $RemoteDir" -ForegroundColor White
Write-Host ""

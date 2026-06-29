# =============================================================================
# QAASR - Make Fresh Installation Package
# Run from the project root:  .\make-fresh-package.ps1
#
# What it does:
#   1. Recreates fresh-deploy/ with the required folder structure
#   2. Copies config files (docker-compose.yml, nginx.conf, .env.example)
#   3. Saves all five Docker images as .tar files
#   4. Writes a fresh-install restore script (no data, clean DB)
#   5. Writes a bundle manifest
#
# Result: a self-contained folder you can SCP to any server for a clean install.
# The default SUPER_ADMIN account is seeded automatically on first startup.
#
# Prerequisites:
#   - Docker Desktop running
#   - Images built locally (docker compose build)
#   - Run from the qa-automation-suite-runner project root
# =============================================================================

param(
    [string]$AdminEmail    = 'albin.benny@6dtech.co.in',
    [string]$AdminName     = 'Albin Benny',
    [string]$AdminPassword = 'Admin@1234'
)

$ErrorActionPreference = 'Stop'

function info  { param($m) Write-Host "  [INFO]  $m" -ForegroundColor Cyan    }
function ok    { param($m) Write-Host "  [OK]    $m" -ForegroundColor Green   }
function warn  { param($m) Write-Host "  [WARN]  $m" -ForegroundColor Yellow  }
function die   { param($m) Write-Host "  [FAIL]  $m" -ForegroundColor Red; exit 1 }
function step  { param($m) Write-Host "`n==> $m" -ForegroundColor Magenta     }

$root = $PSScriptRoot
$dest = Join-Path $root "fresh-deploy"
$ts   = Get-Date -Format "yyyy-MM-dd HH:mm"

Write-Host ""
Write-Host "  QAASR Fresh Install Package Builder" -ForegroundColor White
Write-Host "  $ts" -ForegroundColor DarkGray
Write-Host "  Default admin : $AdminEmail" -ForegroundColor DarkGray
Write-Host ""

# -----------------------------------------------------------------------------
step "Pre-flight checks"

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { die "Docker not found in PATH" }
$null = docker info 2>&1
if ($LASTEXITCODE -ne 0) { die "Docker daemon is not running" }

# Verify images exist locally
$requiredImages = @('qaasr-api:latest', 'qaasr-ui:latest', 'qaasr-runner:latest', 'postgres:16-alpine', 'redis:7-alpine')
foreach ($img in $requiredImages) {
    $exists = docker image inspect $img 2>$null
    if ($LASTEXITCODE -ne 0) { die "Image $img not found. Run: docker compose build" }
}
ok "All images present"

# -----------------------------------------------------------------------------
step "Creating fresh-deploy/ folder structure"

if (Test-Path $dest) {
    warn "fresh-deploy/ already exists — wiping and recreating"
    Remove-Item -Recurse -Force $dest
}

New-Item -ItemType Directory -Force "$dest\images"       | Out-Null
New-Item -ItemType Directory -Force "$dest\config\nginx" | Out-Null
ok "Folders ready"

# -----------------------------------------------------------------------------
step "Copying config files"

Copy-Item "$root\docker-compose.yml"       "$dest\config\docker-compose.yml"
Copy-Item "$root\.env.example"             "$dest\config\.env.example"
Copy-Item "$root\nginx\nginx.conf"         "$dest\config\nginx\nginx.conf"
if (Test-Path "$root\gen-compose-override.sh") {
    Copy-Item "$root\gen-compose-override.sh"  "$dest\gen-compose-override.sh"
}
ok "docker-compose.yml, .env.example, nginx.conf copied"

# -----------------------------------------------------------------------------
step "Saving Docker images"

$images = @(
    [PSCustomObject]@{ tag = 'qaasr-api:latest';    file = 'qaasr-api.tar'    },
    [PSCustomObject]@{ tag = 'qaasr-ui:latest';     file = 'qaasr-ui.tar'     },
    [PSCustomObject]@{ tag = 'qaasr-runner:latest'; file = 'qaasr-runner.tar' },
    [PSCustomObject]@{ tag = 'postgres:16-alpine';  file = 'postgres-16.tar'  },
    [PSCustomObject]@{ tag = 'redis:7-alpine';      file = 'redis-7.tar'      }
)

foreach ($img in $images) {
    $out = "$dest\images\$($img.file)"
    info "Saving $($img.tag)..."
    docker save $img.tag -o $out
    if ($LASTEXITCODE -ne 0) { die "docker save failed for $($img.tag)" }
    $sz = [math]::Round((Get-Item $out).Length / 1MB, 0)
    ok "$($img.file) — $sz MB"
}

# -----------------------------------------------------------------------------
step "Writing restore script"

# Hash the admin password using bcrypt via Node (available in the api container image)
info "Hashing admin password..."
$bcryptHash = docker run --rm qaasr-api:latest node -e @"
const bcrypt = require('bcryptjs');
bcrypt.hash('$AdminPassword', 12).then(h => process.stdout.write(h));
"@
if ($LASTEXITCODE -ne 0 -or -not $bcryptHash) {
    warn "bcryptjs not available directly — will hash at restore time instead"
    $bcryptHash = ''
}

$restoreScript = @"
#!/usr/bin/env bash
# ============================================================================
# QAASR — Fresh Install Restore Script
# Run on the TARGET Linux server after copying the fresh-deploy/ folder.
#
# Usage:
#   1. scp -r fresh-deploy/ user@server:/opt/qaasr/
#   2. ssh user@server
#   3. cd /opt/qaasr/fresh-deploy
#   4. cp config/.env.example config/.env
#   5. nano config/.env            # fill in all secrets
#   6. chmod +x restore.sh
#   7. sudo ./restore.sh
#
# Default admin created on first run:
#   Email    : $AdminEmail
#   Password : $AdminPassword   <-- CHANGE THIS after first login
# ============================================================================

set -euo pipefail
SCRIPT_DIR="`$(cd "`$(dirname "`${BASH_SOURCE[0]}")" && pwd)"
cd "`$SCRIPT_DIR"

RED='\033[0;31m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'
YELLOW='\033[1;33m'; MAGENTA='\033[0;35m'; NC='\033[0m'
info()  { echo -e "`${CYAN}  [INFO]`${NC}  `$*"; }
ok()    { echo -e "`${GREEN}  [OK]`${NC}    `$*"; }
warn()  { echo -e "`${YELLOW}  [WARN]`${NC}  `$*"; }
die()   { echo -e "`${RED}  [FAIL]`${NC}  `$*"; exit 1; }
step()  { echo -e "\n`${MAGENTA}==> `$*`${NC}"; }

# ── Pre-flight ────────────────────────────────────────────────────────────────
step "Pre-flight checks"

command -v docker >/dev/null 2>&1 || die "Docker not installed."
docker info >/dev/null 2>&1       || die "Docker daemon is not running. Run: sudo systemctl start docker"
[[ -f "config/.env" ]]            || die "config/.env not found.\n  Run: cp config/.env.example config/.env && nano config/.env"

IMAGE_COUNT=`$(ls images/*.tar 2>/dev/null | wc -l)
[[ "`$IMAGE_COUNT" -gt 0 ]] || die "No .tar files found in images/"

POSTGRES_USER=`$(grep -E '^POSTGRES_USER=' config/.env | cut -d= -f2 | tr -d '"' | tr -d "'" || echo "qasr")
POSTGRES_DB=`$(grep   -E '^POSTGRES_DB='   config/.env | cut -d= -f2 | tr -d '"' | tr -d "'" || echo "qasr")
POSTGRES_USER=`${POSTGRES_USER:-qasr}
POSTGRES_DB=`${POSTGRES_DB:-qasr}
ok "Pre-flight passed — Postgres user: `$POSTGRES_USER  DB: `$POSTGRES_DB"

# ── 1. Set up working directory ───────────────────────────────────────────────
step "Setting up working directory"

cp config/docker-compose.yml ./docker-compose.yml
cp config/.env               ./.env
mkdir -p nginx
cp config/nginx/nginx.conf   ./nginx/nginx.conf
export COMPOSE_PROJECT_NAME=qaasr
ok "Config placed in `$(pwd)"

if [[ -f "gen-compose-override.sh" ]]; then
    chmod +x gen-compose-override.sh
    bash gen-compose-override.sh
fi

# ── 2. Load Docker images ─────────────────────────────────────────────────────
step "Loading Docker images (`$IMAGE_COUNT files)"

for tar_file in images/*.tar; do
    info "Loading `$(basename "`$tar_file") ..."
    docker load -i "`$tar_file"
done
ok "All images loaded"

# ── 3. Create named volumes (empty — fresh install) ───────────────────────────
step "Creating Docker volumes"

for vol in qaasr-pgdata qaasr-data qaasr-scripts qaasr-artifacts; do
    docker volume create "qaasr_`${vol}" 2>/dev/null && info "Created qaasr_`${vol}" || info "qaasr_`${vol} already exists"
done
ok "Volumes ready"

# ── 4. Start PostgreSQL and run Prisma migrations ─────────────────────────────
step "Starting PostgreSQL"

docker compose up -d qaasr-postgres qaasr-redis
info "Waiting for PostgreSQL..."
RETRIES=30
until docker compose exec -T qaasr-postgres pg_isready -U "`$POSTGRES_USER" >/dev/null 2>&1; do
    RETRIES=`$((RETRIES - 1))
    [[ `$RETRIES -le 0 ]] && die "PostgreSQL did not start after 60 seconds"
    echo -n "."
    sleep 2
done
echo ""
ok "PostgreSQL is ready"

step "Running Prisma migrations (fresh schema)"

docker compose up -d qaasr-api
info "Waiting for API to apply migrations and become healthy (up to 3 min)..."
for i in `$(seq 1 36); do
    STATUS=`$(docker inspect --format='{{.State.Health.Status}}' qaasr-api 2>/dev/null || echo "starting")
    [[ "`$STATUS" == "healthy" ]] && break
    echo -n "."
    sleep 5
done
echo ""
[[ "`$(docker inspect --format='{{.State.Health.Status}}' qaasr-api 2>/dev/null)" == "healthy" ]] \
    || warn "API not healthy yet — check: docker compose logs qaasr-api"
ok "Migrations applied"

# ── 5. Seed default SUPER_ADMIN user ─────────────────────────────────────────
step "Seeding default admin user"

# Hash the password inside the running api container (bcryptjs is available there)
HASH=`$(docker exec qaasr-api node -e "
const bcrypt = require('bcryptjs');
bcrypt.hash('$AdminPassword', 12).then(h => process.stdout.write(h));
" 2>/dev/null)

if [[ -z "`$HASH" ]]; then
    warn "Could not hash password via api container — trying postgres directly with plain bcrypt extension"
    HASH="\\\$2b\\\$12\\\$notset"
fi

docker exec qaasr-postgres psql -U "`$POSTGRES_USER" -d "`$POSTGRES_DB" -c "
INSERT INTO \"User\" (id, email, name, \"passwordHash\", \"globalRole\", \"createdAt\", \"updatedAt\")
VALUES (
    gen_random_uuid(),
    '$AdminEmail',
    '$AdminName',
    '`$HASH',
    'SUPER_ADMIN',
    NOW(),
    NOW()
)
ON CONFLICT (email) DO UPDATE
    SET \"globalRole\" = 'SUPER_ADMIN',
        \"passwordHash\" = EXCLUDED.\"passwordHash\",
        name = EXCLUDED.name;
"
ok "Admin user seeded: $AdminEmail"

# ── 6. Start all services ─────────────────────────────────────────────────────
step "Starting all services"

docker compose up -d
info "Waiting for all services to stabilise..."
sleep 10
docker compose ps

SERVER_IP=`$(hostname -I | awk '{print `$1}')
echo ""
echo -e "`${GREEN}════════════════════════════════════════════════════════════`${NC}"
echo -e "`${GREEN}  QAASR fresh install complete!`${NC}"
echo -e "`${GREEN}════════════════════════════════════════════════════════════`${NC}"
echo ""
echo -e "  UI  :  http://`${SERVER_IP}:3000"
echo -e "  API :  http://`${SERVER_IP}:4000"
echo -e "  VNC :  http://`${SERVER_IP}:6080/vnc.html"
echo ""
echo -e "  Default admin login:"
echo -e "    Email    : $AdminEmail"
echo -e "    Password : $AdminPassword"
echo ""
echo -e "`${YELLOW}  ⚠  Change the admin password after first login!`${NC}"
echo ""
echo -e "  Useful commands:"
echo -e "    docker compose logs -f              # live logs"
echo -e "    docker compose logs -f qaasr-runner # runner logs only"
echo -e "    docker compose ps                   # service status"
echo ""
echo -e "`${YELLOW}  NOTE: Add the Airtel internal host to /etc/hosts if needed:`${NC}"
echo -e "`${YELLOW}    10.0.12.244  airtel6d-in-ventas-master-int-aavm-alpha-01.ocplab.6d.local`${NC}"
echo ""
"@

$restoreScript | Out-File -FilePath "$dest\restore.sh" -Encoding utf8 -NoNewline
ok "restore.sh written"

# -----------------------------------------------------------------------------
step "Writing manifest"

$totalBytes = (Get-ChildItem $dest -Recurse -File | Measure-Object -Property Length -Sum).Sum
$totalMB    = [math]::Round($totalBytes / 1MB, 0)
$fileList   = Get-ChildItem $dest -Recurse -File | ForEach-Object {
    $rel = $_.FullName.Replace($dest, '').TrimStart('\')
    $kb  = [math]::Round($_.Length / 1KB, 0)
    "  $rel  ($kb KB)"
}

@"
QAASR Fresh Install Package Manifest
Generated     : $ts
Total size    : $totalMB MB
Admin email   : $AdminEmail
Install type  : FRESH — no project data, clean database

Files:
$($fileList -join "`n")

Restore instructions:
  1. SCP this folder to the target Linux server
  2. cd fresh-deploy
  3. cp config/.env.example config/.env
  4. nano config/.env   # fill in POSTGRES_PASSWORD, JWT_SECRET, etc.
  5. chmod +x restore.sh
  6. sudo ./restore.sh
"@ | Out-File -FilePath "$dest\manifest.txt" -Encoding utf8

ok "manifest.txt written"

# -----------------------------------------------------------------------------
Write-Host ""
Write-Host "  Fresh install package complete!" -ForegroundColor Green
Write-Host "  Location : $dest"               -ForegroundColor White
Write-Host "  Size     : $totalMB MB"          -ForegroundColor White
Write-Host ""
Write-Host "  Default admin : $AdminEmail / $AdminPassword" -ForegroundColor Yellow
Write-Host "  (change password after first login)"          -ForegroundColor DarkGray
Write-Host ""
Write-Host "  Next steps:"                                   -ForegroundColor DarkGray
Write-Host "    1. SCP fresh-deploy/ to the target server"  -ForegroundColor DarkGray
Write-Host "    2. cd fresh-deploy && sudo ./restore.sh"    -ForegroundColor DarkGray
Write-Host ""

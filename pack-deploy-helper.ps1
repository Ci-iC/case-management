# One-shot pack v1.1 deploy zip
# Called from the pack-deploy bat. Pre-req: node_modules installed, dist/ built.
$ErrorActionPreference = "Stop"

$ZipName = "case-management-v1.1.zip"
$ZipPath = Join-Path (Get-Location) $ZipName
$EnvProd = ".env.production"

# --- 1. Prepare .env.production ---
# Rules:
#   - missing       -> copy from local .env + append OpenAI placeholders
#   - has DB_FILE   -> v1.0 legacy, rewrite to v1.1 format
#   - already v1.1  -> keep as-is

$rewrite = $false
if (-not (Test-Path $EnvProd)) {
    Write-Host "  [.env.production] not found, generating from .env..." -ForegroundColor Cyan
    $rewrite = $true
} else {
    $existing = Get-Content $EnvProd -Raw -ErrorAction SilentlyContinue
    if (($existing -match 'DB_FILE\s*=') -or ($existing -notmatch 'DATABASE_URL\s*=')) {
        Write-Host "  [.env.production] is v1.0 legacy, rewriting to v1.1 format..." -ForegroundColor Yellow
        $rewrite = $true
    } else {
        Write-Host "  [.env.production] already v1.1 format, keeping as-is" -ForegroundColor Green

        # Cleanup pass: even when keeping as-is, strip out NODE_ENV= lines
        # (older versions of this helper injected NODE_ENV=production, which Vite then complains about at build time)
        if ($existing -match '(?m)^NODE_ENV\s*=') {
            Write-Host "  [.env.production] found stale NODE_ENV line, stripping it (Vite warns on it)" -ForegroundColor Yellow
            $cleaned = ($existing -split "`r?`n" | Where-Object { $_ -notmatch '^\s*NODE_ENV\s*=' }) -join "`r`n"
            $absPath = Join-Path (Get-Location) $EnvProd
            $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
            [System.IO.File]::WriteAllText($absPath, $cleaned, $utf8NoBom)
        }
    }
}

if ($rewrite) {
    if (-not (Test-Path ".env")) {
        Write-Error "Local .env does not exist. Cannot generate .env.production."
        exit 1
    }
    # IMPORTANT: read as UTF-8 (PS 5.1 -Raw defaults to GBK on Chinese Windows,
    # which would corrupt non-ASCII values like ADMIN_DISPLAY_NAME)
    $envBytes = [System.IO.File]::ReadAllBytes((Resolve-Path ".env"))
    # Strip UTF-8 BOM if present
    if ($envBytes.Length -ge 3 -and $envBytes[0] -eq 0xEF -and $envBytes[1] -eq 0xBB -and $envBytes[2] -eq 0xBF) {
        $envBytes = $envBytes[3..($envBytes.Length - 1)]
    }
    $envContent = [System.Text.Encoding]::UTF8.GetString($envBytes)

    $openaiBlock = "`r`n`r`n# OpenAI (admin can set via system settings UI; placeholder is OK)`r`nOPENAI_API_KEY=sk-replace-me`r`nOPENAI_BASE_URL=https://api.openai.com/v1`r`nOPENAI_MODEL_DEFAULT=gpt-4o-mini`r`n`r`n# Upload size limit (20MB)`r`nUPLOAD_MAX_BYTES=20971520`r`n"

    if ($envContent -notmatch 'OPENAI_API_KEY\s*=') {
        $envContent = $envContent.TrimEnd() + $openaiBlock
    }
    # NOTE: do NOT inject NODE_ENV=production here. Vite reads .env.production at build time
    # and will refuse / warn if it sees NODE_ENV. The server side (PM2 / systemd) sets NODE_ENV
    # at process startup, not via .env.

    # Write without BOM (dotenv compatibility)
    $absPath = Join-Path (Get-Location) $EnvProd
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($absPath, $envContent, $utf8NoBom)

    Write-Host "  > .env.production generated (copied from local .env)" -ForegroundColor Green
    Write-Host "  ! Reminder: after deploy, edit /opt/case-management/.env on server:" -ForegroundColor Yellow
    Write-Host "    Update ADMIN_PASSWORD / PG_PASSWORD (sync DATABASE_URL) / JWT_SECRET" -ForegroundColor Yellow
}
Write-Host ""

# --- 2. Verify build artifacts ---
if (-not (Test-Path "dist\index.html")) {
    Write-Error "dist/index.html not found. The bat should have run npm run build; check earlier output."
    exit 1
}

# --- 3. Pack zip ---
$itemsToZip = @(
    "package.json", "package-lock.json", "knexfile.js", "vite.config.ts",
    "tsconfig.json", "tsconfig.node.json", "postcss.config.js", "tailwind.config.js",
    "index.html", "docker-compose.yml",
    "src", "server", "scripts", "dist",
    ".env.production"
)

$missing = $itemsToZip | Where-Object { -not (Test-Path $_) }
if ($missing) {
    Write-Error ("Missing files/dirs: " + ($missing -join ', '))
    exit 1
}

if (Test-Path $ZipPath) {
    Remove-Item $ZipPath -Force
}

Write-Host "  Packing zip..." -ForegroundColor Cyan
Compress-Archive -Path $itemsToZip -DestinationPath $ZipPath -Force

$zipSize = [math]::Round((Get-Item $ZipPath).Length / 1MB, 2)
Write-Host ""
Write-Host "  > Pack complete" -ForegroundColor Green
Write-Host "    Path: $ZipPath" -ForegroundColor White
Write-Host "    Size: $zipSize MB" -ForegroundColor White
Write-Host ""

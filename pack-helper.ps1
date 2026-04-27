# 手动组装 Electron 应用，不依赖 electron-builder / winCodeSign
# 无需管理员权限，无需额外下载
$ErrorActionPreference = "Stop"

$appName     = "案件台账管理系统"
$electronSrc = "node_modules\electron\dist"
$outputRoot  = "dist-exe"
$outputDir   = "$outputRoot\$appName"
$zipPath     = "$outputRoot\$appName.zip"

# 检查前置条件
if (-not (Test-Path $electronSrc)) {
    Write-Error "未找到 Electron 运行时，请先运行 npm install"
    exit 1
}
if (-not (Test-Path "dist\index.html")) {
    Write-Error "未找到前端构建产物，请先运行 npm run build"
    exit 1
}

# 清理旧输出
Write-Host "  清理旧输出..." -ForegroundColor Cyan
if (Test-Path $outputDir) { Remove-Item $outputDir -Recurse -Force }
if (Test-Path $zipPath)   { Remove-Item $zipPath   -Force }

# 复制 Electron 运行时
Write-Host "  复制 Electron 运行时..." -ForegroundColor Cyan
Copy-Item $electronSrc $outputDir -Recurse

# 写入应用文件
Write-Host "  写入应用文件..." -ForegroundColor Cyan
$appDir = Join-Path $outputDir "resources\app"
New-Item -ItemType Directory -Path $appDir -Force | Out-Null

Copy-Item "dist"     (Join-Path $appDir "dist")     -Recurse -Force
Copy-Item "electron" (Join-Path $appDir "electron") -Recurse -Force

$pkgPath = Join-Path $appDir "package.json"
$pkg = '{"name":"case-management","version":"1.0.0","main":"electron/main.cjs"}'
[System.IO.File]::WriteAllText($pkgPath, $pkg, [System.Text.Encoding]::UTF8)

# 重命名可执行文件
Write-Host "  重命名可执行文件..." -ForegroundColor Cyan
$exePath = Join-Path $outputDir "electron.exe"
if (Test-Path $exePath) {
    Rename-Item $exePath "$appName.exe"
} else {
    Write-Warning "未找到 electron.exe"
}

# 压缩为 zip
Write-Host "  压缩为 zip 文件..." -ForegroundColor Cyan
Compress-Archive -Path $outputDir -DestinationPath $zipPath -Force

Write-Host ""
Write-Host "  打包成功！" -ForegroundColor Green
Write-Host "  发送文件：$zipPath" -ForegroundColor Green
Write-Host "  使用方式：解压后双击 $appName.exe 即可运行" -ForegroundColor Green

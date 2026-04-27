@echo off

echo.
echo ==========================================
echo   案件台账管理系统 - 打包工具
echo ==========================================
echo.

:: 切换到 bat 所在目录
cd /d "%~dp0"

:: 检查 Node.js
node --version >/dev/null 2>&1
if %errorlevel% neq 0 (
    echo [错误] 未检测到 Node.js，请先安装后重试。
    echo        下载地址：https://nodejs.org
    echo.
    pause
    exit /b 1
)
for /f "tokens=*" %%v in ('node --version') do set NODE_VER=%%v
echo [OK] Node.js %NODE_VER%
echo.

:: 安装依赖
echo [1/3] 安装依赖（首次运行需下载 Electron 约 110MB，请耐心等待）...
echo ------------------------------------------
call npm install
if %errorlevel% neq 0 (
    echo.
    echo [错误] 依赖安装失败，请检查网络。
    echo 国内网络可先执行以下命令设置镜像再重试：
    echo   npm config set registry https://registry.npmmirror.com
    echo   npm config set ELECTRON_MIRROR https://npmmirror.com/mirrors/electron/
    echo.
    pause
    exit /b 1
)
echo.

:: 编译前端
echo [2/3] 编译前端资源...
echo ------------------------------------------
call npm run build
if %errorlevel% neq 0 (
    echo.
    echo [错误] 前端编译失败，请检查源码。
    echo.
    pause
    exit /b 1
)
echo.

:: 手动组装 Electron 应用（不依赖 electron-builder，无需管理员权限）
echo [3/3] 组装并压缩应用...
echo ------------------------------------------
powershell -ExecutionPolicy Bypass -File pack-helper.ps1
if %errorlevel% neq 0 (
    echo.
    echo [错误] 打包失败，请查看上方错误信息。
    echo.
    pause
    exit /b 1
)

echo.
echo 正在打开输出目录...
explorer dist-exe

pause
exit /b 0

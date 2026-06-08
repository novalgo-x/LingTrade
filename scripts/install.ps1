# LingTrade Windows 安装脚本：在 PowerShell 中运行 .\scripts\install.ps1
# 若提示「在此系统上禁止运行脚本」，改用：powershell -ExecutionPolicy Bypass -File scripts\install.ps1
# 网络检测与镜像切换逻辑见 scripts/setup.mjs

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "未检测到 Node.js，请先前往 https://nodejs.org/ 安装 Node.js 20 或更高版本后重试。"
    exit 1
}

node "$PSScriptRoot\setup.mjs"
exit $LASTEXITCODE

#!/usr/bin/env bash
# LingTrade 安装脚本（macOS / Linux / WSL）
# 网络检测与镜像切换逻辑见 scripts/setup.mjs
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if ! command -v node >/dev/null 2>&1; then
  echo "✗ 未检测到 Node.js，请先前往 https://nodejs.org/ 安装 Node.js 20 或更高版本后重试。"
  exit 1
fi

node "$ROOT/scripts/setup.mjs"

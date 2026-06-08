#!/usr/bin/env node
// LingTrade 跨平台安装脚本（Windows / macOS / Linux 通用）
// 自动检测网络环境：GitHub 直连不可用时切换到国内镜像（npmmirror），
// 依次安装根目录、web/server、web/client 三处依赖，完成后打印使用指引。
// 仅使用 Node 内置模块，安装任何依赖之前即可运行。

import { spawnSync } from "node:child_process";
import { request } from "node:https";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MIRROR_REGISTRY = "https://registry.npmmirror.com";
// better-sqlite3 的预编译二进制不走 npm registry，而是直连 GitHub releases 下载，
// 需要通过专用变量单独重定向到镜像
const BINARY_MIRROR = "https://npmmirror.com/mirrors/better-sqlite3/";

const nodeMajor = Number(process.versions.node.split(".")[0]);
if (nodeMajor < 20) {
  console.error(`✗ 需要 Node.js >= 20，当前为 v${process.versions.node}`);
  console.error("  请前往 https://nodejs.org/ 安装新版本后重试。");
  process.exit(1);
}

// 任何 HTTP 响应都算可达；连接超时 / 失败视为不可达
function probe(url, timeout = 4000) {
  return new Promise((resolve) => {
    const req = request(url, { method: "HEAD", timeout }, (res) => {
      res.resume();
      resolve(true);
    });
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.on("error", () => resolve(false));
    req.end();
  });
}

console.log("🔍 检测网络环境 ...");
// 探测 GitHub release 资产所在的主机（而非 github.com 首页——国内常见首页可达但资产下载被阻断）
const githubOk = await probe("https://objects.githubusercontent.com/");
const useMirror = !githubOk;

if (useMirror) {
  console.log("   GitHub 直连不可用，已自动启用国内镜像（npmmirror）加速安装");
  console.log("   （安装过程中 npm 可能提示 Unknown env config 警告，可忽略）");
} else {
  console.log("   网络通畅，使用官方源安装");
}

const env = { ...process.env };
if (useMirror) {
  env.npm_config_better_sqlite3_binary_host_mirror = BINARY_MIRROR;
}

// 用户在 .npmrc 里自定义过 registry（企业源 / 已配镜像）时尊重用户配置
const envRegistry = process.env.npm_config_registry ?? "";
const hasCustomRegistry = envRegistry !== "" && !envRegistry.includes("registry.npmjs.org");
const registryArgs = useMirror && !hasCustomRegistry ? [`--registry=${MIRROR_REGISTRY}`] : [];

const steps = [
  ["分析引擎（根目录）", ["install"]],
  ["Web 服务端", ["install", "--prefix", "web/server"]],
  ["Web 前端", ["install", "--prefix", "web/client"]],
];

for (const [label, args] of steps) {
  console.log(`\n📦 安装依赖：${label} ...`);
  const result = spawnSync("npm", [...args, ...registryArgs], {
    cwd: ROOT,
    env,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    console.error(`\n✗ ${label} 依赖安装失败（退出码 ${result.status ?? "未知"}）。`);
    console.error("  请检查网络后重新运行 npm run setup；若依旧失败，可手动切换镜像源后重试：");
    console.error(`    npm config set registry ${MIRROR_REGISTRY}`);
    process.exit(result.status ?? 1);
  }
}

const startHint =
  process.platform === "win32"
    ? "       npm run dev             （Ctrl+C 停止）"
    : "       bash scripts/start.sh   （后台运行，bash scripts/stop.sh 停止）\n       npm run dev             （前台运行，Ctrl+C 停止）";

console.log(`
✅ 安装完成！接下来：

  1. 启动前后端服务：
${startHint}

  2. 打开浏览器访问：
       http://localhost:26680

  3. 首次使用会弹出新手向导，按指引配置 Tushare 数据源与大模型 API 即可开始体验。
`);

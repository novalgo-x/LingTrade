#!/usr/bin/env bash
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SERVER_PORT="${WEB_SERVER_PORT:-26681}"
CLIENT_PORT="${VITE_PORT:-26680}"

# 依赖安装由 scripts/install.sh 负责，这里只做检查
for dir in node_modules web/server/node_modules web/client/node_modules; do
  if [ ! -d "$ROOT/$dir" ]; then
    echo "✗ 依赖尚未安装，请先运行：bash scripts/install.sh"
    exit 1
  fi
done

# Kill any processes already on our ports
for port in "$SERVER_PORT" "$CLIENT_PORT"; do
  pids=$(lsof -ti :"$port" 2>/dev/null || true)
  if [ -n "$pids" ]; then
    echo "$pids" | xargs kill -9 2>/dev/null || true
  fi
done

echo "==> Starting backend on port $SERVER_PORT..."
cd "$ROOT/web/server"
npx tsx src/index.ts &

echo "==> Starting frontend on port $CLIENT_PORT..."
cd "$ROOT/web/client"
npx vite --port "$CLIENT_PORT" &

sleep 2
echo ""
echo "LingTrade is running:"
echo "  Frontend:  http://localhost:$CLIENT_PORT"
echo "  Backend:   http://localhost:$SERVER_PORT"
echo ""
echo "Run scripts/stop.sh to stop."

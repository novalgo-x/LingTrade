#!/usr/bin/env bash

SERVER_PORT="${WEB_SERVER_PORT:-26681}"
CLIENT_PORT="${VITE_PORT:-26680}"
PID_DIR="$(cd "$(dirname "$0")" && pwd)"
stopped=0

for pair in "server $SERVER_PORT" "client $CLIENT_PORT"; do
  name="${pair%% *}"
  port="${pair##* }"
  pids=$(lsof -ti :"$port" 2>/dev/null || true)
  if [ -n "$pids" ]; then
    echo "$pids" | xargs kill -9 2>/dev/null
    echo "Stopped $name on port $port"
    stopped=$((stopped + 1))
  fi
  rm -f "$PID_DIR/$name.pid"
done

if [ "$stopped" -eq 0 ]; then
  echo "No running LingTrade processes found."
else
  echo "LingTrade stopped."
fi

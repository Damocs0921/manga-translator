#!/usr/bin/env bash
# 一键启动漫画翻译器（后端 :8000 + 前端 :5173）
set -e
cd "$(dirname "$0")"

# 若已在运行则跳过
if curl -s -o /dev/null http://localhost:8000/api/projects; then
  echo "后端已在运行 (:8000)"
else
  echo "启动后端..."
  (cd backend && ../.venv/bin/uvicorn main:app --port 8000 > /tmp/uvicorn.log 2>&1 &)
fi

if curl -s -o /dev/null http://localhost:5173; then
  echo "前端已在运行 (:5173)"
else
  echo "启动前端..."
  (cd frontend && npm run dev > /tmp/vite.log 2>&1 &)
fi

sleep 2
echo ""
echo "就绪: http://localhost:5173"

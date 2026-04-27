#!/usr/bin/env bash
#
# One-shot deploy: 本地打包 → scp 到服务器 → 远端安装依赖 + 构建前端 + pm2 reload。
#
# 安全保证（不会动服务器上的数据）：
#   • 服务器上的 .env 不会被覆盖
#   • server/data/ 里的 SQLite 数据库不会被覆盖
#
# 首次使用：
#   1. 复制 .deploy.env.example → .deploy.env，填上服务器 IP/用户/路径
#   2. 在项目根目录创建 .env.production，内容同 .env（但换成生产用的强密码/密钥）
#   3. bash deploy.sh
#
# 日常更新：直接 bash deploy.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ─── 加载配置 ────────────────────────────────────────────────────────────────
if [[ ! -f .deploy.env ]]; then
  echo "❌ 缺少 .deploy.env —— 请先 cp .deploy.env.example .deploy.env 并填写服务器信息。"
  exit 1
fi
# shellcheck disable=SC1091
source .deploy.env

: "${DEPLOY_HOST:?必须在 .deploy.env 里设置 DEPLOY_HOST}"
: "${DEPLOY_USER:=root}"
: "${DEPLOY_PORT:=22}"
: "${DEPLOY_DIR:=/opt/case-management}"
: "${PM2_NAME:=case-mgmt}"

SSH_CMD="ssh -p $DEPLOY_PORT $DEPLOY_USER@$DEPLOY_HOST"
SCP_CMD="scp -P $DEPLOY_PORT"

STAMP=$(date +%Y%m%d-%H%M%S)
LOCAL_TAR="/tmp/case-management-$STAMP.tar.gz"
REMOTE_TAR="/tmp/case-management-$STAMP.tar.gz"

# ─── 1. 本地打包 ─────────────────────────────────────────────────────────────
echo "[1/5] 📦 打包本地代码..."
tar \
  --exclude='./node_modules' \
  --exclude='./dist' \
  --exclude='./dist-exe' \
  --exclude='./server/data' \
  --exclude='./.env' \
  --exclude='./.env.production' \
  --exclude='./.git' \
  --exclude='./.deploy.env' \
  --exclude='./.deploy.env.example' \
  --exclude='./deploy.sh' \
  --exclude='./electron' \
  --exclude='./docs' \
  -czf "$LOCAL_TAR" .

SIZE=$(du -h "$LOCAL_TAR" | cut -f1)
echo "    ✓ $LOCAL_TAR ($SIZE)"

# ─── 2. 上传 ────────────────────────────────────────────────────────────────
echo "[2/5] 🚀 上传到 $DEPLOY_USER@$DEPLOY_HOST:$DEPLOY_DIR ..."
$SSH_CMD "mkdir -p $DEPLOY_DIR"
$SCP_CMD "$LOCAL_TAR" "$DEPLOY_USER@$DEPLOY_HOST:$REMOTE_TAR"

# 如果服务器还没 .env，且本地有 .env.production，则作为初始配置上传
if [[ -f .env.production ]]; then
  if ! $SSH_CMD "test -f $DEPLOY_DIR/.env"; then
    echo "    ℹ 服务器上没有 .env，将本地 .env.production 作为初始配置上传"
    $SCP_CMD .env.production "$DEPLOY_USER@$DEPLOY_HOST:$DEPLOY_DIR/.env"
  fi
fi

# ─── 3. 解压 + 安装依赖 + 构建前端 ───────────────────────────────────────────
echo "[3/5] 🔧 远端解压 / npm install / npm run build ..."
$SSH_CMD bash -s <<REMOTE
set -euo pipefail
cd "$DEPLOY_DIR"
tar -xzf "$REMOTE_TAR"

if [[ ! -f .env ]]; then
  echo "❌ 服务器上 $DEPLOY_DIR/.env 不存在 —— 首次部署请在本地创建 .env.production 后重试"
  exit 1
fi

mkdir -p server/data

echo "  → npm install"
npm install --no-audit --no-fund

echo "  → npm run build"
npm run build

rm -f "$REMOTE_TAR"
REMOTE

# ─── 4. pm2 启动 / 重载 ──────────────────────────────────────────────────────
echo "[4/5] ♻️  pm2 启动或重载..."
$SSH_CMD bash -s <<REMOTE
set -euo pipefail
cd "$DEPLOY_DIR"
if pm2 describe "$PM2_NAME" >/dev/null 2>&1; then
  pm2 reload "$PM2_NAME" --update-env
else
  pm2 start npm --name "$PM2_NAME" -- start
  pm2 save
fi
pm2 status "$PM2_NAME"
REMOTE

# ─── 5. 清理 ────────────────────────────────────────────────────────────────
echo "[5/5] 🧹 清理本地临时文件..."
rm -f "$LOCAL_TAR"

echo ""
echo "✅ 部署完成！"
echo "   浏览器访问: http://$DEPLOY_HOST/"
echo ""
echo "   查看运行状态:  ssh $DEPLOY_USER@$DEPLOY_HOST 'pm2 status'"
echo "   查看日志:      ssh $DEPLOY_USER@$DEPLOY_HOST 'pm2 logs $PM2_NAME --lines 50'"

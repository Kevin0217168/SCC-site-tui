#!/usr/bin/env bash
# ska-site-tui 部署脚本（在服务器上执行）
#
# 两种用法：
#
#   1) CI 推送（推荐）
#        ./scripts/deploy.sh --payload .incoming/payload.tar.gz
#      解包产物 → 按需装依赖 → 同步服务定义 → 重启 → 健康检查
#
#   2) 本机手动重建
#        ./scripts/deploy.sh
#      用当前目录的源码重新构建后重启（等价于旧的 ska.sh rebuild）
#
# 其它：
#   ./scripts/deploy.sh --rollback   回滚到上一次成功部署的 dist/
#   ./scripts/deploy.sh --status     只看状态，不做任何变更
#
# 设计要点：
#   - 依赖只在 bun.lock 变化时重装，所以日常部署只传几百 KB 的产物
#   - .env / .keys / .data 属于服务器本地状态，解包时永不覆盖
#   - 支持「只改 content/」的场景：不重启，靠 5 秒缓存自动生效
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

BUN_BIN="${BUN_BIN:-$HOME/.bun/bin/bun}"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
SERVICES=(ska-content-api.service ska-site-tui.service)
STATE_DIR="$PROJECT_DIR/.deploy-state"
PAYLOAD=""

# 这些是服务器本地状态，解包时必须排除，否则会把线上的配置/密钥冲掉。
# 注意 content/ 不在其中：文章以 Git 仓库为唯一真源，多人 PR 合并后要能上线。
# 如果你的写作工作流是「直接在服务器上改 content/」，把下面这行改成 1。
PRESERVE_CONTENT="${DEPLOY_PRESERVE_CONTENT:-0}"

PROTECTED_BASE=(./.env ./.keys ./.data ./.deploy-state ./.incoming)
PROTECTED=("${PROTECTED_BASE[@]}")
[[ "$PRESERVE_CONTENT" == "1" ]] && PROTECTED+=(./content)

# ── 输出 ──────────────────────────────────────────────────────────────
c_info() { printf '\033[36m▸\033[0m %s\n' "$*"; }
c_ok()   { printf '\033[32m✓\033[0m %s\n' "$*"; }
c_warn() { printf '\033[33m!\033[0m %s\n' "$*"; }
c_err()  { printf '\033[31m✗\033[0m %s\n' "$*" >&2; }

die() { c_err "$*"; exit 1; }

# ── 参数解析 ──────────────────────────────────────────────────────────
MODE="apply"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --payload) PAYLOAD="${2:-}"; [[ -f "$PAYLOAD" ]] || die "找不到 payload：$PAYLOAD"; shift 2 ;;
    --rollback) MODE="rollback"; shift ;;
    --status) MODE="status"; shift ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) die "未知参数：$1" ;;
  esac
done

# ── 前置检查 ──────────────────────────────────────────────────────────
# 放在函数里而不是顶层，这样解包逻辑可以独立测试/复用
preflight() {
  [[ -x "$BUN_BIN" ]] || die "找不到 Bun：$BUN_BIN（先跑 scripts/provision.sh）"

  # 非交互式 SSH 会话里 systemctl --user 需要 XDG_RUNTIME_DIR
  if [[ -z "${XDG_RUNTIME_DIR:-}" ]] || [[ ! -d "${XDG_RUNTIME_DIR:-/nonexistent}" ]]; then
    export XDG_RUNTIME_DIR="/run/user/$(id -u)"
  fi
  if ! systemctl --user show-environment >/dev/null 2>&1; then
    die "systemd 用户实例不可用（XDG_RUNTIME_DIR=$XDG_RUNTIME_DIR）。"
  fi
}

# ── 解包 ──────────────────────────────────────────────────────────────
extract_payload() {
  [[ -n "$PAYLOAD" ]] || return 0

  c_info "解包 $PAYLOAD"
  mkdir -p "$STATE_DIR"

  # 先把当前产物备份成 rollback 点
  if [[ -d dist ]]; then
    rm -rf "$STATE_DIR/dist.prev"
    cp -r dist "$STATE_DIR/dist.prev"
  fi

  local excludes=()
  for p in "${PROTECTED[@]}"; do
    excludes+=(--exclude "$p" "--exclude=$p/*")
  done

  # 先解到临时目录，避免 tar 直接盖到正在被读取的文件上
  local staging
  staging="$(mktemp -d "$STATE_DIR/staging.XXXXXX")"
  tar xzf "$PAYLOAD" -C "$staging" --no-same-owner

  # content/ 需要「整目录替换」语义：仓库里删掉的文章要在线上真的消失。
  # 单纯覆盖式解包做不到这点，所以单独搬一次。
  if [[ "$PRESERVE_CONTENT" != "1" ]] && [[ -d "$staging/content" ]]; then
    rm -rf content.next
    mv "$staging/content" content.next
    rm -rf content
    mv content.next content
    c_ok "文章目录已替换（$(find content -name '*.md' | wc -l) 篇 markdown）"
  fi

  # 其余文件覆盖式同步（服务器上没有 rsync，用 tar 管道代替）
  tar cf - -C "$staging" . | tar xf - -C "$PROJECT_DIR" "${excludes[@]}"
  rm -rf "$staging"

  # CI 会把 commit sha 写成产物根目录的 REVISION
  [[ -f REVISION ]] && mv REVISION "$STATE_DIR/revision"

  c_ok "产物已同步（.env/.keys/.data 未动）"
}

# ── 依赖 ──────────────────────────────────────────────────────────────
ensure_env() {
  [[ -f .env ]] && return 0
  [[ -f .env.example ]] || { c_warn "既没有 .env 也没有 .env.example"; return 0; }

  cp .env.example .env
  c_warn "已从 .env.example 生成 .env —— 上线前请检查这几项："
  c_warn "  SKA_WEB_BASE_URL / CONTENT_API_PORT / GH_PROXY / AI_API_KEY"
  c_warn "改完执行：systemctl --user restart ${SERVICES[*]}"
}

ensure_deps() {
  [[ -f bun.lock ]] || die "缺少 bun.lock，无法锁定依赖版本"

  local current recorded
  current="$(sha256sum bun.lock | cut -d' ' -f1)"
  recorded="$(cat "$STATE_DIR/bun.lock.sha256" 2>/dev/null || echo '')"

  if [[ "$current" == "$recorded" ]] && [[ -d node_modules ]]; then
    c_ok "依赖无变化，跳过安装"
    return 0
  fi

  if [[ ! -d node_modules ]]; then
    c_info "首次安装依赖（约 180MB）"
  else
    c_info "bun.lock 有变化，重新安装依赖"
  fi

  export BUN_INSTALL_CACHE_DIR="${BUN_INSTALL_CACHE_DIR:-$HOME/.bun/install/cache}"

  # 官方源不可达时退回 npmmirror（国内机房更稳）
  if ! "$BUN_BIN" install --frozen-lockfile; then
    c_warn "官方 npm 源安装失败，改用 npmmirror 重试"
    BUN_CONFIG_REGISTRY="https://registry.npmmirror.com" \
      "$BUN_BIN" install --frozen-lockfile || die "依赖安装失败"
  fi

  mkdir -p "$STATE_DIR"
  printf '%s' "$current" > "$STATE_DIR/bun.lock.sha256"
  c_ok "依赖就绪"
}

# ── 构建 ──────────────────────────────────────────────────────────────
build_locally() {
  c_info "构建中（$BUN_BIN run build）"
  "$BUN_BIN" run build >/dev/null || die "构建失败"
  c_ok "构建完成：dist/index.js"
}

# ── 服务定义 ──────────────────────────────────────────────────────────
sync_units() {
  [[ -d deploy ]] || { c_warn "没有 deploy/ 目录，跳过服务定义同步"; return 0; }

  mkdir -p "$UNIT_DIR"
  local changed=0 unit target rendered
  for unit in deploy/ska-*.service; do
    [[ -f "$unit" ]] || continue
    target="$UNIT_DIR/$(basename "$unit")"
    # @PROJECT_DIR@ 占位符替换为实际绝对路径，仓库可 checkout 到任意目录
    rendered="$(sed "s|@PROJECT_DIR@|$PROJECT_DIR|g" "$unit")"
    if [[ ! -f "$target" ]] || ! printf '%s\n' "$rendered" | cmp -s - "$target"; then
      printf '%s\n' "$rendered" > "$target"
      changed=1
    fi
  done

  if [[ "$changed" == "1" ]]; then
    systemctl --user daemon-reload
    c_ok "服务定义已更新并 reload"
  else
    c_ok "服务定义无变化"
  fi

  # 首次部署时确保已 enable
  systemctl --user enable "${SERVICES[@]}" >/dev/null
}

# ── 重启与健康检查 ────────────────────────────────────────────────────
content_api_port() {
  local port
  port="$(grep -E '^CONTENT_API_PORT=' .env 2>/dev/null | tail -1 | cut -d= -f2 | tr -d '[:space:]')"
  echo "${port:-8787}"
}

tui_port() {
  local port
  port="$(grep -E '^PORT=' .env 2>/dev/null | tail -1 | cut -d= -f2 | tr -d '[:space:]')"
  echo "${port:-2222}"
}

restart_services() {
  c_info "重启服务"
  systemctl --user restart "${SERVICES[@]}"
}

wait_for_port() {
  local port="$1" name="$2" i
  for i in $(seq 1 30); do
    if ss -tln 2>/dev/null | grep -q ":${port}\b"; then
      c_ok "$name 已监听 :$port（${i}00ms）"
      return 0
    fi
    sleep 0.1
  done
  c_err "$name 在 3 秒内没有监听 :$port"
  return 1
}

health_check() {
  local port tport ok=0
  port="$(content_api_port)"
  tport="$(tui_port)"

  wait_for_port "$port" "内容 API" || ok=1
  wait_for_port "$tport" "TUI 服务" || ok=1

  local body
  body="$(curl -fsS --max-time 5 "http://127.0.0.1:${port}/" 2>/dev/null)" || {
    c_err "内容 API 自检失败（curl http://127.0.0.1:${port}/）"
    ok=1
  }
  if [[ -n "$body" ]]; then
    c_ok "内容 API 自检通过"
  fi

  if [[ "$ok" != "0" ]]; then
    c_err "健康检查未通过，最近日志："
    systemctl --user --no-pager -n 25 -u "${SERVICES[@]}" 2>&1 | tail -40
    # 低端口 EACCES 是最常见的启动失败原因，单独把解法打出来
    if (( tport < 1024 )); then
      local start
      start="$(cat /proc/sys/net/ipv4/ip_unprivileged_port_start 2>/dev/null || echo 1024)"
      if (( start > tport )); then
        c_err "PORT=$tport 低于非特权端口下限（$start），这就是启动失败的原因。放开："
        c_err "  echo 'net.ipv4.ip_unprivileged_port_start=$tport' | sudo tee /etc/sysctl.d/99-scc-site-tui.conf && sudo sysctl --system"
      fi
    fi
    return 1
  fi
  return 0
}

# ── 子命令 ────────────────────────────────────────────────────────────
cmd_status() {
  preflight
  for s in "${SERVICES[@]}"; do
    printf '\n\033[1m── %s ──\033[0m\n' "$s"
    systemctl --user status "$s" --no-pager --lines=0 2>&1 | head -8 || true
  done
  local tport aport
  tport="$(tui_port)"
  aport="$(content_api_port)"
  printf '\n监听端口（.env: PORT=%s, CONTENT_API_PORT=%s）：\n' "$tport" "$aport"
  ss -tlnp 2>/dev/null | grep -E ":($tport|$aport)\b" || echo "  （都没有在监听）"
  printf '\n已部署版本：%s\n' "$(cat "$STATE_DIR/revision" 2>/dev/null || echo unknown)"
}

cmd_rollback() {
  preflight
  [[ -d "$STATE_DIR/dist.prev" ]] || die "没有可回滚的产物（$STATE_DIR/dist.prev 不存在）"
  c_info "回滚 dist/ 到上一次部署"
  rm -rf dist
  cp -r "$STATE_DIR/dist.prev" dist
  restart_services
  health_check || die "回滚后健康检查仍未通过"
  c_ok "回滚完成"
}

cmd_apply() {
  extract_payload
  # --payload 模式下产物由 CI 构建好；否则本机构建
  [[ -n "$PAYLOAD" ]] || build_locally
  [[ -f dist/index.js ]] || die "dist/index.js 不存在，产物不完整"
  preflight
  ensure_env
  ensure_deps
  sync_units
  restart_services
  health_check || exit 1
  c_ok "部署完成"
}

case "$MODE" in
  status) cmd_status ;;
  rollback) cmd_rollback ;;
  apply) cmd_apply ;;
esac

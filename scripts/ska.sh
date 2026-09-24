#!/usr/bin/env bash
# ska-site-tui 日常控制脚本
#
#   ./scripts/ska.sh install      安装并启动 systemd 用户服务（开机自启）
#   ./scripts/ska.sh uninstall    停止并移除服务
#   ./scripts/ska.sh status       查看两个服务的状态
#   ./scripts/ska.sh start        启动
#   ./scripts/ska.sh stop         停止
#   ./scripts/ska.sh restart      重启
#   ./scripts/ska.sh logs         跟踪主服务日志
#   ./scripts/ska.sh rebuild      重新构建后重启（改了 src/ 后用这个）
#   ./scripts/ska.sh refresh      清空内容缓存并重启（改了 content/ 想立刻生效时用）
#   ./scripts/ska.sh content      查看内容 API 自检信息
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
SERVICES=(ska-content-api.service ska-site-tui.service)

# 优先用 PATH 里的 bun，找不到再退回标准安装位置
if command -v bun >/dev/null 2>&1; then
  BUN_BIN="$(command -v bun)"
else
  BUN_BIN="$HOME/.bun/bin/bun"
fi

log() { printf '\033[36m▸\033[0m %s\n' "$*"; }

# 读 .env 里的键值（Bun 会自动加载 .env，这里只是为了展示和检查）
env_value() {
  local key="$1" fallback="${2:-}" v=""
  if [[ -f "$PROJECT_DIR/.env" ]]; then
    v="$(grep -E "^${key}=" "$PROJECT_DIR/.env" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '[:space:]')"
  fi
  printf '%s' "${v:-$fallback}"
}

# deploy/*.service 里的 @PROJECT_DIR@ 是占位符，安装时替换成实际路径，
# 这样仓库被 clone 到任何目录都能用。
render_units() {
  mkdir -p "$UNIT_DIR"
  local f
  for f in "$PROJECT_DIR"/deploy/ska-*.service; do
    [[ -f "$f" ]] || continue
    sed "s|@PROJECT_DIR@|$PROJECT_DIR|g" "$f" > "$UNIT_DIR/$(basename "$f")"
  done
}

# 1024 以下的端口需要额外授权，否则服务启动时 EACCES
check_low_port() {
  local port start
  port="$(env_value PORT 2222)"
  [[ "$port" =~ ^[0-9]+$ ]] || return 0
  (( port >= 1024 )) && return 0

  start="$(cat /proc/sys/net/ipv4/ip_unprivileged_port_start 2>/dev/null || echo 1024)"
  [[ "$start" =~ ^[0-9]+$ ]] || start=1024
  (( start <= port )) && return 0

  log "注意：.env 里 PORT=$port 低于非特权端口下限（$start），服务会因 EACCES 起不来"
  log "放开方式（需 root，一次性，二选一）："
  log "  echo 'net.ipv4.ip_unprivileged_port_start=$port' | sudo tee /etc/sysctl.d/99-scc-site-tui.conf && sudo sysctl --system"
  log "  sudo setcap cap_net_bind_service=+ep \"$BUN_BIN\""
  return 1
}

require_systemd() {
  if ! systemctl --user is-system-running >/dev/null 2>&1 &&
    ! systemctl --user list-units >/dev/null 2>&1; then
    echo "错误：systemd 用户实例不可用，请改用 scripts/ska.sh run 前台启动" >&2
    exit 1
  fi
}

cmd_install() {
  require_systemd
  log "安装到 $UNIT_DIR"
  render_units
  systemctl --user daemon-reload
  check_low_port || true
  systemctl --user enable --now "${SERVICES[@]}"
  # 没有 linger 时，用户注销后服务会被 systemd 停掉
  if ! loginctl show-user "$USER" 2>/dev/null | grep -q 'Linger=yes'; then
    log "提示：当前未开启 linger，注销后服务会停止。开启需要执行："
    log "  sudo loginctl enable-linger $USER"
  else
    log "linger 已开启，注销后服务仍会常驻"
  fi
  sleep 2
  cmd_status
}

cmd_uninstall() {
  require_systemd
  log "停止并禁用服务"
  systemctl --user disable --now "${SERVICES[@]}" 2>/dev/null || true
  rm -f "$UNIT_DIR"/ska-content-api.service "$UNIT_DIR"/ska-site-tui.service
  systemctl --user daemon-reload
  log "完成（内容与构建产物都保留）"
}

cmd_status() {
  require_systemd
  for s in "${SERVICES[@]}"; do
    printf '\n\033[1m── %s ──\033[0m\n' "$s"
    systemctl --user status "$s" --no-pager --lines=0 2>&1 | head -12 || true
  done
  local tui_port api_port
  tui_port="$(env_value PORT 2222)"
  api_port="$(env_value CONTENT_API_PORT 8787)"
  printf '\n监听端口（.env: PORT=%s, CONTENT_API_PORT=%s）：\n' "$tui_port" "$api_port"
  ss -tlnp 2>/dev/null | grep -E ":($tui_port|$api_port)\b" || echo "  （都没有在监听）"
}

cmd_start() { require_systemd; systemctl --user start "${SERVICES[@]}"; cmd_status; }
cmd_stop() { require_systemd; systemctl --user stop "${SERVICES[@]}"; log "已停止"; }
cmd_restart() { require_systemd; systemctl --user restart "${SERVICES[@]}"; cmd_status; }

cmd_logs() {
  require_systemd
  systemctl --user -u ska-site-tui.service -f
}

cmd_rebuild() {
  log "构建中..."
  (cd "$PROJECT_DIR" && "$BUN_BIN" run build)
  log "重启主服务"
  systemctl --user restart ska-site-tui.service
  cmd_status
}

cmd_refresh() {
  # 适配器有 30 分钟缓存（内存 + .data/*.json），改完内容想立刻看到就清掉
  log "清空内容缓存 .data/"
  rm -rf "$PROJECT_DIR/.data"
  systemctl --user restart "${SERVICES[@]}"
  cmd_status
}

cmd_content() {
  local api_port
  api_port="$(env_value CONTENT_API_PORT 8787)"
  log "内容 API 自检（127.0.0.1:$api_port）："
  curl -s --max-time 5 "http://127.0.0.1:${api_port}/" || {
    echo "  内容 API 无响应" >&2
    exit 1
  }
  echo
}

cmd_run() {
  # 不走 systemd 的前台启动，方便调试
  log "前台启动（Ctrl+C 退出）"
  trap 'kill 0' EXIT INT TERM
  (cd "$PROJECT_DIR" && "$BUN_BIN" run tools/content-api.ts) &
  sleep 1
  (cd "$PROJECT_DIR" && "$BUN_BIN" run dist/index.js)
}

case "${1:-}" in
  install) cmd_install ;;
  uninstall) cmd_uninstall ;;
  status) cmd_status ;;
  start) cmd_start ;;
  stop) cmd_stop ;;
  restart) cmd_restart ;;
  logs) cmd_logs ;;
  rebuild) cmd_rebuild ;;
  refresh) cmd_refresh ;;
  content) cmd_content ;;
  run) cmd_run ;;
  *)
    sed -n '2,16p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
    exit 1
    ;;
esac

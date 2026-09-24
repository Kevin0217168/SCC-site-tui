#!/usr/bin/env bash
# ska-site-tui 服务器初始化（在目标服务器上执行，幂等，可重复运行）
#
#   ./scripts/provision.sh            初始化环境
#   ./scripts/provision.sh --check    只做体检，不安装任何东西
#
# 做四件事：
#   1. 安装 Bun（默认走 npmmirror，绕开 GitHub 封锁）
#   2. 准备项目目录与 .env
#   3. 安装两个 systemd 用户服务
#   4. 检查 linger（注销后服务是否常驻）
#
# 注意：本脚本只写用户空间（$HOME），不需要 root。
#       唯一需要 root 的是 `loginctl enable-linger`，脚本会提示你自己执行。
set -euo pipefail

# ── 配置 ──────────────────────────────────────────────────────────────
PROJECT_DIR="${PROJECT_DIR:-$HOME/ska-site-tui}"
BUN_DIR="${BUN_DIR:-$HOME/.bun}"
BUN_BIN="$BUN_DIR/bin/bun"
BUN_VERSION="${BUN_VERSION:-1.4.2}"
NPMMIRROR="${NPMMIRROR:-https://registry.npmmirror.com/-/binary/bun}"
SERVICES=(ska-content-api.service ska-site-tui.service)
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"

CHECK_ONLY=0
[[ "${1:-}" == "--check" ]] && CHECK_ONLY=1

# ── 输出 ──────────────────────────────────────────────────────────────
c_info() { printf '\033[36m▸\033[0m %s\n' "$*"; }
c_ok()   { printf '\033[32m✓\033[0m %s\n' "$*"; }
c_warn() { printf '\033[33m!\033[0m %s\n' "$*"; }
c_err()  { printf '\033[31m✗\033[0m %s\n' "$*" >&2; }

# ── 1. Bun ────────────────────────────────────────────────────────────
detect_arch() {
  case "$(uname -m)" in
    x86_64|amd64) echo "x64" ;;
    aarch64|arm64) echo "aarch64" ;;
    *) c_err "不支持的架构：$(uname -m)"; exit 1 ;;
  esac
}

install_bun_mirror() {
  local arch zip url tmp
  arch="$(detect_arch)"
  zip="bun-linux-${arch}.zip"
  url="$NPMMIRROR/bun-v${BUN_VERSION}/${zip}"
  tmp="$(mktemp -d)"

  c_info "从 npmmirror 下载 Bun v${BUN_VERSION}（${arch}）"
  if ! curl -fsSL --max-time 300 -o "$tmp/bun.zip" "$url"; then
    rm -rf "$tmp"
    return 1
  fi

  # 服务器上可能没有 unzip，退回到 python3 / busybox
  if command -v unzip >/dev/null 2>&1; then
    unzip -o -q "$tmp/bun.zip" -d "$tmp/extract"
  elif command -v python3 >/dev/null 2>&1; then
    python3 -c "import zipfile,sys; zipfile.ZipFile('$tmp/bun.zip').extractall('$tmp/extract')"
  elif command -v busybox >/dev/null 2>&1; then
    busybox unzip -o "$tmp/bun.zip" -d "$tmp/extract" >/dev/null
  else
    c_err "缺少解压工具（unzip / python3 / busybox 都没有）"
    rm -rf "$tmp"
    return 1
  fi

  mkdir -p "$BUN_DIR/bin"
  cp "$tmp/extract/bun-linux-${arch}/bun" "$BUN_BIN"
  chmod +x "$BUN_BIN"
  rm -rf "$tmp"
  return 0
}

install_bun_official() {
  c_info "回退到官方安装脚本（需要能访问 github.com）"
  local script
  script="$(mktemp)"
  curl -fsSL --max-time 60 https://bun.sh/install -o "$script" || {
    c_err "无法获取安装脚本"; rm -f "$script"; return 1
  }
  BUN_INSTALL="$BUN_DIR" bash "$script"
  rm -f "$script"
}

ensure_bun() {
  if [[ -x "$BUN_BIN" ]]; then
    c_ok "Bun 已安装：$("$BUN_BIN" --version)"
    return
  fi
  if [[ "$CHECK_ONLY" == "1" ]]; then
    c_warn "Bun 未安装（--check 模式，跳过安装）"
    return
  fi

  install_bun_mirror || install_bun_official || {
    c_err "Bun 安装失败。可在**能上 GitHub 的机器**上下载 bun-linux-x64.zip，"
    c_err "解压后把 bun 放到 $BUN_BIN 再重跑本脚本。"
    exit 1
  }
  c_ok "Bun 安装完成：$("$BUN_BIN" --version)"
}

# ── 2. 项目目录与 .env ────────────────────────────────────────────────
ensure_project_dir() {
  if [[ -d "$PROJECT_DIR" ]]; then
    c_ok "项目目录已存在：$PROJECT_DIR"
  elif [[ "$CHECK_ONLY" == "1" ]]; then
    c_warn "项目目录不存在：$PROJECT_DIR"
  else
    mkdir -p "$PROJECT_DIR"
    c_ok "已创建项目目录：$PROJECT_DIR"
  fi

  if [[ -f "$PROJECT_DIR/.env" ]]; then
    c_ok ".env 已存在，保留不动"
    return
  fi
  [[ "$CHECK_ONLY" == "1" ]] && { c_warn ".env 不存在"; return; }

  if [[ -f "$PROJECT_DIR/.env.example" ]]; then
    cp "$PROJECT_DIR/.env.example" "$PROJECT_DIR/.env"
    c_ok "已从 .env.example 生成 .env"
  else
    c_warn ".env.example 还没有（代码尚未同步），稍后由 deploy.sh 生成"
  fi
}

# ── 3. systemd 用户服务 ───────────────────────────────────────────────
has_user_systemd() {
  systemctl --user show-environment >/dev/null 2>&1
}

install_services() {
  if ! has_user_systemd; then
    c_err "systemd 用户实例不可用，无法安装服务。"
    c_err "请确认系统使用 systemd，并且当前是通过 SSH 以普通用户登录。"
    exit 1
  fi

  if [[ ! -f "$PROJECT_DIR/deploy/ska-site-tui.service" ]]; then
    c_warn "还没同步 deploy/*.service，跳过服务安装（先跑一次 deploy.sh）"
    return
  fi
  if [[ "$CHECK_ONLY" == "1" ]]; then
    c_info "服务定义存在，--check 模式不安装"
    return
  fi

  c_info "安装服务到 $UNIT_DIR"
  mkdir -p "$UNIT_DIR"
  cp "$PROJECT_DIR"/deploy/ska-*.service "$UNIT_DIR/"
  systemctl --user daemon-reload
  systemctl --user enable "${SERVICES[@]}" >/dev/null
  c_ok "服务已注册（开机自启）"
}

# ── 4. linger ─────────────────────────────────────────────────────────
check_linger() {
  local user linger
  user="$(id -un)"
  linger="$(loginctl show-user "$user" -p Linger --value 2>/dev/null || echo unknown)"

  case "$linger" in
    yes) c_ok "linger 已开启，注销后服务仍常驻" ;;
    no|unknown)
      c_warn "linger 未开启：断开 SSH 后服务会被 systemd 停掉。"
      c_warn "请手动执行一次（需要 root 密码）："
      printf '\n    sudo loginctl enable-linger %s\n\n' "$user"
      ;;
  esac
}

check_hostname() {
  local host
  host="$(hostname)"
  if ! getent hosts "$host" >/dev/null 2>&1; then
    c_warn "$host 不在 /etc/hosts 里，每次 sudo 都会报 'unable to resolve host'。"
    c_warn "修（需要 root）：sudo sed -i 's/^127\\.0\\.0\\.1.*/& $host/' /etc/hosts"
  fi
}

# ── 汇总 ──────────────────────────────────────────────────────────────
summary() {
  printf '\n\033[1m── 体检结果 ──\033[0m\n'
  printf '  项目目录   %s\n' "$PROJECT_DIR"
  printf '  Bun        %s\n' "$([[ -x $BUN_BIN ]] && "$BUN_BIN" --version || echo '未安装')"
  printf '  服务单元   %s\n' "$(ls "$UNIT_DIR"/ska-*.service 2>/dev/null | wc -l) 个"
  printf '  .env       %s\n' "$([[ -f $PROJECT_DIR/.env ]] && echo '已就绪' || echo '缺失')"
  printf '  2222 端口  %s\n' "$(ss -tln 2>/dev/null | grep -q ':2222' && echo '被占用' || echo '空闲')"
  printf '\n'
}

main() {
  c_info "链路检查："
  if curl -fsS -o /dev/null --max-time 10 https://registry.npmmirror.com/ 2>/dev/null; then
    c_ok "npmmirror 可达（Bun 与 npm 依赖走这里）"
  else
    c_warn "npmmirror 不可达"
  fi
  if curl -fsS -o /dev/null --max-time 10 https://github.com 2>/dev/null; then
    c_ok "github.com 可达"
  else
    c_warn "github.com 不可达 —— 属预期情况，本方案已绕开（Bun 走镜像、部署走 SSH 推送）"
  fi
  echo

  ensure_bun
  ensure_project_dir
  install_services
  check_linger
  check_hostname
  summary
  c_info "下一步：在本地/CI 执行一次部署，或直接跑 $PROJECT_DIR/scripts/deploy.sh"
}

main "$@"

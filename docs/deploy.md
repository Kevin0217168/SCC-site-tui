# 部署到 MintServer-SH

面向 `MintServer-SH`（Debian 13 / 腾讯云上海）的部署说明。核心思路是
**CI 构建 → SSH 推送产物 → 服务器只收几百 KB**，日常部署不传依赖。
本文所有命令都经过实机验证。

## 一、为什么是这个方案

目标服务器有两个硬约束，方案是围绕它们设计的：

| 实测项 | 结果 | 影响 |
| --- | --- | --- |
| `github.com:443`（HTTPS） | ❌ 超时（12s 无响应） | 不能用 `git clone https://`；`curl bun.sh \| bash` 也会失败 |
| `github.com:22`（SSH） | ✅ 通 | GitHub Actions 推送到服务器不受影响 |
| `registry.npmjs.org` / `registry.npmmirror.com` | ✅ 通（~15MB/s） | 依赖走 npm 源，Bun 走 npmmirror |
| `gh-proxy.com` 等 GitHub 代理 | ✅ 通 | tree-sitter 语法资产从这里取 |

另外服务器上**没有 rsync、没有 git、没有 node**，只有 `curl` / `tar` / `unzip` /
`python3`，所以传输用 `tar | ssh`，装 Bun 用 npmmirror 的预编译包。

## 二、架构

```mermaid
graph TB
    subgraph GitHub
        PR[PR / 分支推送] --> B[build 任务<br/>bun install + build]
        M[合并到 master] --> D[deploy 任务]
        B -.->|PR 校验，不部署| PR
        D --> P[打包 payload.tar.gz<br/>不含 node_modules]
    end

    P -->|ssh + tar| S["MintServer-SH<br/>~/ska-site-tui"]

    subgraph S2["服务器上的两个 systemd 用户服务"]
        S --> A["ska-content-api.service<br/>127.0.0.1:8787"]
        S --> T["ska-site-tui.service<br/>0.0.0.0:$PORT（默认 2222，可设 22）"]
    end

    U[SSH 客户端] -->|ssh -p $PORT| T
    T -->|SKA_WEB_BASE_URL| A
    A --> C["content/*.md"]
```

**每次部署的传输量**：

> 本文里的服务器目录统一写作 `~/ska-site-tui`（CI 里的默认值）。
> 想改名就设仓库变量 `DEPLOY_PATH`（`Settings → Secrets and variables →
> Actions → Variables`），workflow 和脚本会跟着走。

| 内容 | 大小 | 频率 |
| --- | --- | --- |
| `dist/index.js` | ~1.3 MB | 每次 |
| `content/` `scripts/` `deploy/` `tools/` | 几十 KB | 每次 |
| `node_modules/` | ~182 MB | **仅 `bun.lock` 变化时**（在服务器上就地安装，不走 CI 传输） |

## 三、首次部署

### 3.1 本地准备一次：把新文件提交上去

`content/`、`deploy/`、`scripts/`、`tools/` 之前没有纳入版本管理，
服务器 clone/解包时会缺文件，必须先提交：

```bash
git add content deploy scripts tools docs .env.example .gitignore \
        Dockerfile package.json .github/workflows/deploy.yml src/
git commit -m "feat: 本地内容源 + 部署脚本 + CI 部署流水线"
git push origin master
```

### 3.2 服务器初始化

```bash
# 从本地推一份脚本过去（服务器上还没有仓库）
scp -r scripts MintServer-SH:~/ska-site-tui/

# 先体检，不动任何东西
ssh MintServer-SH 'cd ~/ska-site-tui && ./scripts/provision.sh --check'

# 正式初始化：装 Bun、建目录、注册 systemd 服务
ssh MintServer-SH 'mkdir -p ~/ska-site-tui && cd ~/ska-site-tui && ./scripts/provision.sh'
```

### 3.3 开 linger（需要 root 密码，只能你手动做）

不开启的话，**断开 SSH 后服务会被 systemd 停掉**：

```bash
ssh MintServer-SH
sudo loginctl enable-linger mint
```

顺手修掉 `sudo` 每次报的 `unable to resolve host`：

```bash
sudo sed -i "s/^127\.0\.0\.1.*/& $(hostname)/" /etc/hosts
```

### 3.4 第一次部署

本地跑一次和 CI 相同的流程即可（也可以直接在 GitHub 上点
`Actions → Deploy → Run workflow`）：

```bash
cd /path/to/ska-site-tui
bun install --frozen-lockfile && bun run build

mkdir -p build && cp -r dist content tools deploy scripts \
  package.json bun.lock tsconfig.json build.ts bunfig.toml .env.example build/
git rev-parse --short HEAD > build/REVISION
tar czf payload.tar.gz -C build .

ssh MintServer-SH 'mkdir -p ~/ska-site-tui/.incoming'
cat payload.tar.gz | ssh MintServer-SH 'cat > ~/ska-site-tui/.incoming/payload.tar.gz'

ssh MintServer-SH
cd ~/ska-site-tui
tar xzf .incoming/payload.tar.gz ./scripts/
bash scripts/deploy.sh --payload .incoming/payload.tar.gz
```

首次会在服务器上安装依赖（182 MB，实测下载约 2.4 秒）。
这一步会自动从 `.env.example` 生成一份 `.env`，并**打印需要你检查的字段**。

### 3.5 检查 `.env`

```bash
ssh MintServer-SH
cd ~/ska-site-tui
vi .env
```

重点确认这几行：

```ini
SKA_WEB_BASE_URL=http://127.0.0.1:8787   # 指向本机内容 API
CONTENT_API_PORT=8787
PORT=22                                  # TUI 对外端口；22 需要额外授权，见 3.5.1
GH_PROXY=https://gh-proxy.com/           # ← 墙内服务器必须填，否则代码块高亮失效
AI_API_KEY=sk-xxxx                       # 不填则自动禁用 AI 对话
SSH_AUTH=publickey                       # ← 监听 22 时务必改掉默认的 open，见第八节
# SSH_IDLE_TIMEOUT=10m
```

> `GH_PROXY` 是最容易被忽略的一项。`src/theme/parsers-config.ts` 里 34 个语言的
> 语法高亮 wasm 默认从 `github.com` 下载，在这台服务器上会 12 秒超时。
> 填上代理后实测 85 个资产 URL **全部 200**。

#### 3.5.1 若 `PORT` 小于 1024（例如 22）

低端口需要额外授权，否则服务启动时报 `EACCES`。实测本机
`/proc/sys/net/ipv4/ip_unprivileged_port_start = 1024`，以 `mint` 身份
`bind(22)` 会直接 `Permission denied`。二选一（需 root 密码）：

```bash
# 方案 A（推荐）：放开非特权端口下限，一次性，升级 bun 不受影响
echo 'net.ipv4.ip_unprivileged_port_start=22' | sudo tee /etc/sysctl.d/99-scc-site-tui.conf
sudo sysctl --system

# 方案 B：只给 bun 二进制授权（注意：升级/重装 bun 后需要重新执行）
sudo setcap cap_net_bind_service=+ep "$(readlink -f "$HOME/.bun/bin/bun")"
```

`scripts/provision.sh` 和 `scripts/ska.sh install` 都会自动检测这种情况并把
命令直接打印出来，不用记。

> ⚠️ **用 22 端口就必须配好认证。** 22 是全互联网扫描量最大的端口，
> 而本项目默认 `SSH_AUTH=open`，等于把 TUI 完全敞开。详见第八节。

改完重启：

```bash
systemctl --user restart ska-site-tui ska-content-api
```

### 3.6 配 GitHub Secrets

服务器上生成一把**只用于这套 CI 的独立密钥**（不要复用你自己登录用的密钥）：

```bash
ssh MintServer-SH 'ssh-keygen -t ed25519 -f ~/.ssh/gha_deploy -N "" -C "gha-deploy"'
ssh MintServer-SH 'cat ~/.ssh/gha_deploy.pub >> ~/.ssh/authorized_keys'
ssh MintServer-SH 'cat ~/.ssh/gha_deploy'   # ← 私钥，填进下面的 secret
```

在仓库 `Settings → Secrets and variables → Actions` 添加：

| Secret | 值 | 必填 |
| --- | --- | --- |
| `DEPLOY_SSH_KEY` | 上面打印的私钥全文 | ✅ |
| `DEPLOY_HOST` | `111.229.10.239` | ✅ |
| `DEPLOY_USER` | `mint` | ✅ |
| `DEPLOY_PORT` | `1324` | ✅ |
| `DEPLOY_KNOWN_HOSTS` | 见下方命令输出 | 建议 |

`DEPLOY_KNOWN_HOSTS` 用来防止中间人攻击。在**可信网络**下采集一次：

```bash
ssh-keyscan -p 1324 -H 111.229.10.239
```

不配的话 workflow 会退化成每次现场 `ssh-keyscan`（可用，但首次连接理论上可被劫持）。

配置完就可以 `git push` 测试了。

## 四、日常协作流程

| 角色 | 改什么 | 流程 | 上线耗时 |
| --- | --- | --- | --- |
| 写文章 | `content/posts/*.md`、`content/notes/*.md` | GitHub 网页 `Add file → Create new file` → 提 PR → 合并 | ~1 分钟（构建 + 替换 content/ + 重启） |
| 改代码 | `src/**` | 本地分支 → PR（CI 会跑构建校验）→ 合并 | ~2 分钟 |
| 改服务/脚本 | `deploy/**`、`scripts/**` | 同上 | ~1 分钟 |
| 改配置 | `.env.example` | 提 PR；线上 `.env` 由 owner 在服务器手动改 | 手动 |

写文章时只要文件名就是 slug，frontmatter 格式见
[local-content.md](./local-content.md)：

```markdown
---
title: 标题
date: 2026-09-25
tags: [标签A, 标签B]
excerpt: 列表里显示的摘要，省略则自动取正文首段
---

正文从这里开始。
```

**合并到 master 即上线**，不需要任何人手动操作。

### 分支保护建议

`Settings → Branches → Add rule`，保护 `master`：

- ✅ Require a pull request before merging
- ✅ Require status checks to pass → 选 `构建校验`
- ✅ Require conversation resolution before merging

不要求审批的话，小团队做到「CI 必须过」就够挡住绝大多数事故了。

## 五、手动运维

服务器上 `~/ska-site-tui/scripts/` 下：

```bash
./scripts/deploy.sh --status     # 看状态、端口、当前部署的 commit
./scripts/deploy.sh              # 用服务器上的源码重建并重启
./scripts/deploy.sh --rollback   # 回滚到上一次成功部署的 dist/
./scripts/provision.sh --check   # 环境体检
./scripts/ska.sh logs            # 跟踪日志
./scripts/ska.sh refresh         # 清内容缓存并重启
```

内容改动**不需要重启**：`.env` 里 `CONTENT_CACHE_TTL_MS=5000` 让目录缓存 5 秒过期。
缓存策略是「先给旧数据再后台刷新」，所以存盘后第一次连接可能是旧列表，第二次就对。

## 六、排查

### 列表显示 0 篇

```bash
curl -s http://127.0.0.1:8787/ | head        # 看 counts
systemctl --user status ska-content-api      # 服务是否在跑
ls ~/ska-site-tui/content/posts/             # 文章是否同步上来
```

### 部署后服务没起来

```bash
systemctl --user status ska-site-tui --no-pager -n 40
journalctl --user -u ska-site-tui -f
```

`deploy.sh` 在健康检查失败时会自动打印最近 25 行日志。

### 服务自己停了（断开 SSH 之后）

linger 没开。`loginctl show-user mint -p Linger` 应为 `yes`。

### 代码块没有语法高亮

`GH_PROXY` 没配或代理挂了。验证：

```bash
grep GH_PROXY ~/ska-site-tui/.env
curl -o /dev/null -w '%{http_code}\n' --max-time 20 \
  "https://gh-proxy.com/https://github.com/tree-sitter/tree-sitter-json/releases/download/v0.24.8/tree-sitter-json.wasm"
```

返回 `200` 就正常。资源会被缓存到 `~/.local/share/opentui/tree-sitter/`，只下第一次。

### 装了 Bun 但 `ska.sh` 说找不到

`scripts/ska.sh` 硬编码 `$HOME/.bun/bin/bun`。如果你装在别处：

```bash
export BUN_BIN=/path/to/bun        # deploy.sh 认这个变量
ln -s /path/to/bun ~/.bun/bin/bun  # ska.sh 认这个路径
```

### 端口被占用

```bash
ss -tlnp | grep -E ':(22|2222|8787)'    # 换成 .env 里的 PORT / CONTENT_API_PORT
```

## 七、其它部署方式

### Docker（备选）

仓库里有 `Dockerfile` 和 `docker-compose.yml`，tag `v*.*.*` 会推送到 GHCR。
服务器上**没有装 Docker**（只有 1.9 GB 内存，跑 Docker 会明显吃紧），
要用的话：

```bash
# 需要 root
curl -fsSL https://get.docker.com | sh
usermod -aG docker mint
```

注意 `Dockerfile` 里 `SKA_WEB_BASE_URL` 需要指向外部 ska-web 站点
（容器内没有 `content-api` 进程），所以 Docker 路线不适合本仓库的
「本地 markdown 内容源」用法。

### Bun 单文件编译（不推荐）

实测 `bun build --compile` 能产出 115 MB 的自包含可执行文件（`.so` 已内嵌），
好处是服务器**完全不用装 Bun 和依赖**。但有两个坑：

1. tree-sitter worker 在编译模式下找不到入口，需要额外设
   `OTUI_TREE_SITTER_WORKER_PATH` 指向外部 `parser.worker.js`；
2. 每次部署要传 115 MB，比现在的 ~1.5 MB 慢两个数量级。

所以只在「服务器完全无法安装 Bun」时才考虑。

## 八、端口选择与安全

### 端口 22 的风险有多大？

结论：**风险主要来自 `SSH_AUTH=open`（默认值），而不是端口号本身**；
但端口号会把这个风险放大几个数量级。

在 MintServer-SH 上实测到的相关事实：

| 指标 | 实测值 |
| --- | --- |
| 应用空载内存 | 75–78 MB RSS |
| 每个会话增量 | ≈ 4 MB（3 个会话 75 → 86 MB） |
| 服务器内存 | 总 1973 MB，空闲 **371 MB**，available 1486 MB |
| 并发会话上限 | 100（框架默认 `limits.session.global`），**无速率限制** |
| 文件描述符上限 | 1024（`ulimit -n`） |
| 以 `mint` 身份 bind(22) | `Permission denied`（`ip_unprivileged_port_start=1024`） |

风险清单，按严重程度：

1. **零认证 = 零门槛。** `auth: "open"` 下任何完成连接的人直接进入 TUI。
   实测 `ssh -p 2399 任意用户名@127.0.0.1` 不带任何凭据就拿到了会话。
2. **AI 额度可被盗刷。** `src/api/chat.ts` 用的是服务端 `.env` 里的
   `AI_API_KEY`，访客每次对话都花你的钱。这是最实际的损失。
3. **内容全公开。** `content/` 下所有文章、笔记与 `profile.yml` 都可被读取。
4. **资源耗尽。** 按实测每会话约 4 MB，100 个并发 ≈ 400 MB，而空闲内存只有
   371 MB，所以**并发到几十个就有 OOM 风险**。更麻烦的是 OOM killer 可能顺手
   杀掉 `sshd`，那样你会直接失去远程登录能力。
5. **噪音与误判。** 22 会被持续探测，日志查询被淹没；而且 `ssh host` 连上的是
   TUI 而不是 shell，日后自己也会困惑。

> 说明：我**没有**这台机器上 22 端口的扫描量实测数据 —— 22 上没东西在听，
> 扫也扫不出日志；`auth.log` 属 `root:adm` 而当前用户在 `mint sudo` 组读不到；
> `lastb` 未安装。所以"22 是扫描量最大的端口"属于普遍事实，
> 不是我在这里测出来的数字，这里就不给具体次数。

### 建议

| 场景 | 建议 |
| --- | --- |
| 自己/小圈子用，不在乎多加 `-p` | **留在 2222**，加 `SSH_AUTH=anykey` 就足以挡住扫描器 |
| 一定要用 22（想要 `ssh host` 的干净体验） | **必须** `SSH_AUTH=publickey`，并设 `SSH_IDLE_TIMEOUT` |
| 只给特定人访问 | 安全组/防火墙限制来源 IP，比任何应用层手段都有效 |

**任何情况下都不要**在公网 22 端口上保留 `SSH_AUTH=open`。

### 加固配置示例

```ini
# .env
PORT=22
SSH_AUTH=publickey
SSH_IDLE_TIMEOUT=15m
```

公钥名单默认读 `~/.ssh/authorized_keys`：

```bash
ssh MintServer-SH
cat >> ~/.ssh/authorized_keys <<'EOF'
ssh-ed25519 AAAA... 你的笔记本
EOF
systemctl --user restart ska-site-tui
```

验证认证确实生效 —— 下面这条应当被拒绝，而不是进入界面：

```bash
ssh -o PreferredAuthentications=none -p 22 nobody@111.229.10.239
# 期望：Permission denied (publickey).
# 若直接进了 TUI，说明 SSH_AUTH 没生效，检查 .env 是否被服务读到
```

### 进一步收窄

框架支持按连接数收口，改 `src/index.tsx` 的 `createServer`：

```ts
createServer({
  hostKey: { path: "./.keys/host_key" },
  auth: resolveAuth(),
  idleTimeout: IDLE_TIMEOUT,
  limits: { session: { global: 10, perConnection: 1 } }, // 默认 global 是 100
})
```

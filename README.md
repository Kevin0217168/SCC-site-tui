<div align="center">

# SKA-WEB-TUI

**基于 OpenTUI/Solid.JS 的终端 UI 博客服务端，内置 AI 聊天助手，通过 SSH 协议对外提供服务。**


```bash
ssh -p 2222 111.229.10.239        # 部署在 MintServer-SH
```

![License](https://www.shieldcn.dev/github/license/Kevin0217168/SCC-site-tui.svg?variant=ghost&size=sm) 

![Stars](https://www.shieldcn.dev/github/stars/Kevin0217168/SCC-site-tui.svg?variant=secondary&size=sm) ![Commit](https://www.shieldcn.dev/github/last-commit/Kevin0217168/SCC-site-tui.svg?variant=secondary&size=sm) ![CI](https://www.shieldcn.dev/github/ci/Kevin0217168/SCC-site-tui.svg?variant=secondary&size=sm)

</div>



https://github.com/user-attachments/assets/2b6283c4-a1fd-42d4-b4c7-f276a1d8579b

## 分支选择

**master**：作者的个人博客专属适配

**halo-version**：halo博客适配


## 快速开始

### Docker 部署

```bash
docker-compose up -d
```

### 手动构建

```bash
bun install
bun run build
```

### 连接

```bash
ssh -p 2222 user@your-server
```

> 默认任意用户名即可，无需密码 —— 安全影响见下方「安全提示」。
> 端口由 `.env` 里的 `PORT` 决定（默认 2222）。

### 部署到服务器

完整流程见 [`docs/deploy.md`](docs/deploy.md)：CI 构建 + SSH 推送、
多人协作与分支保护、墙内网络（GitHub 不可达）适配、排查清单。
写作流程见 [`docs/local-content.md`](docs/local-content.md)。

### 安全提示

默认 `SSH_AUTH=open`，**任何能连到该端口的人都会直接拿到一个会话**，
并可以使用你在 `.env` 里配置的 AI 额度。这是本项目原本就有的设计
（与是否换端口无关）。若想收紧，改成密钥认证：

```ini
# .env
SSH_AUTH=publickey
# SSH_AUTHORIZED_KEYS=/home/mint/.ssh/authorized_keys   # 默认 ~/.ssh/authorized_keys
# SSH_IDLE_TIMEOUT=10m                                   # 闲置自动断开
```

可选值：`open`（不认证）/ `publickey`（按公钥名单放行）/ `anykey`
（任何持有 SSH 私钥的客户端都能进，可挡掉无脑扫描器）。

## 环境变量

参考 `.env.example` 文件，创建 `.env` 文件。

## 技术栈

 ![TypeScript](https://www.shieldcn.dev/badge/Language-TypeScript-3178C6.svg?logo=typescript&variant=branded&size=sm) ![AI SDK](https://www.shieldcn.dev/badge/Stack-AI_SDK-000000.svg?logo=vercel&variant=branded&size=sm) ![Solid](https://www.shieldcn.dev/badge/Stack-Solid-2C4F7C.svg?logo=solid&variant=branded&size=sm)

| 类别       | 技术              |
| ---------- | ----------------- |
| 运行时     | Bun               |
| UI 框架    | SolidJS + OpenTUI |
| SSH 服务端 | @opentui/ssh      |
| 内容源     | ska-web `/api/v1` |
| AI         | Vercel AI SDK     |
| 记忆系统   | Hindsight（可选） |

## 支持二次开发

主站内容走 ska-web Public API v1，映射到 TUI 原有的文章/笔记视图模型。侧栏「友链」仍可通过硬编码 RSS adapter 接入其它博客源。

## License

[MIT](LICENSE)


## 附录

### docker-compose：对接 ska-web API

```yml
services:
  ska-site-tui:
    build: .
    image: ghcr.io/sakuraofficial/ska-site-tui:latest
    container_name: ska-site-tui
    restart: unless-stopped
    ports:
      - "${PORT:-2222}:2222"
    volumes:
      - ./data/keys:/app/.keys
      - ./.data:/app/.data
    environment:
      - PORT=2222
      - SKA_WEB_BASE_URL=https://ska-web-git-dev-sakuraofficials-projects.vercel.app
      - AI_BASE_URL=https://xxxx/v1   # 或任何 OpenAI 兼容 API
      - AI_API_KEY=xxxxx
      - AI_MODEL=xxx
      - OTUI_USE_CONSOLE=false
      - SHOW_CONSOLE=false
```

将 `SKA_WEB_BASE_URL` 换成 ska-web 站点根 URL（不要带 `/api/v1`）。

<div align="center">

# SKA-SITE-TUI

**基于 OpenTUI/Solid.JS 的终端 UI 博客服务端，内置 AI 聊天助手，通过 SSH 协议对外提供服务。**

**内容来自 [ska-web](https://github.com/sAkuraOfficial/ska-web) 的公开 JSON API v1（[sakura-io.com](https://www.sakura-io.com) / ska-web 预览环境），不再对接 Halo CMS。**

```bash
ssh -p 2222 blog.sakuraofficial.site
```

```bash
ssh -p 2222 13.229.180.39
```

![License](https://www.shieldcn.dev/github/license/sakuraofficial/ska-site-tui.svg?variant=ghost&size=sm) 

![Stars](https://www.shieldcn.dev/github/stars/sakuraofficial/ska-site-tui.svg?variant=secondary&size=sm) ![Commit](https://www.shieldcn.dev/github/last-commit/sakuraofficial/ska-site-tui.svg?variant=secondary&size=sm) ![CI](https://www.shieldcn.dev/github/ci/sakuraofficial/ska-site-tui.svg?variant=secondary&size=sm)

</div>



https://github.com/user-attachments/assets/2b6283c4-a1fd-42d4-b4c7-f276a1d8579b



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

> 任意用户名即可，无需密码。

## 环境变量

参考 `.env.example` 文件，创建 `.env` 文件。

内容源默认指向 ska-web `dev` 预览：

```
SKA_WEB_BASE_URL=https://ska-web-git-dev-sakuraofficials-projects.vercel.app
```

TUI 会请求 `{SKA_WEB_BASE_URL}/api/v1`：文章 `/posts`、笔记 `/notes`、友链 `/friends`、关于 `/profile`。详情正文已是 markdown，无需 HTML 转换。列表按 cursor 分页，会拉完全部条目。

主站列表左侧有 **分类栏**（文章 / 笔记），由 `src/api/categories.ts` 注册表驱动，以后加分类只需追加一项。快捷键：`[` `]` 切换分类，`h` / `←` 回到分类栏，`l` / `Enter` 进入列表，`Tab` 在分类栏、列表、侧栏之间循环。友链 / 关于仍在侧栏「友链」里，不进分类栏。

API 契约见 ska-web 仓库 `docs/public-api.md`（`dev` 分支）。生产站 `https://www.sakura-io.com` 上的公开 API 以实际部署为准；当前 Expo / 本 TUI 使用上述预览地址。

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

主站内容走 ska-web Public API v1，映射到 TUI 原有的文章/笔记/友链视图模型。侧栏仍可通过 RSS adapter 接入其它博客源。

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

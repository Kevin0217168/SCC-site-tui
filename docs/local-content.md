# 本地写作与部署

主站内容不再依赖外部的 ska-web 接口，改为读取本仓库 `content/` 目录下的 markdown。
写作流程是：**存盘 → TUI 可见**，不需要重启任何服务。

## 目录结构

```
content/
├── posts/        # 文章（对应 TUI「分类」栏的「文章」）
├── notes/        # 笔记（对应「笔记」）
└── profile.yml   # 「关于」页的数据
tools/content-api.ts   # 把上面的目录变成 ska-web Public API v1 兼容接口
scripts/ska.sh         # 启停 / 重建 / 刷缓存
deploy/*.service       # systemd 用户服务定义
```

## 写一篇新文章

在 `content/posts/` 下新建 `.md` 文件，文件名就是 URL 里的 slug：

```markdown
---
title: 标题
date: 2026-09-17
tags: [标签A, 标签B]
excerpt: 列表里显示的摘要，省略则自动取正文首段
pinned: true          # 可选，置顶
---

正文从这里开始，直接写 markdown。
```

frontmatter 用 YAML，由 Bun 内置的 `Bun.YAML` 解析，不需要额外依赖。
`date` 决定排序（倒序），`pinned: true` 的会排在最前。

字段说明：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `title` | 否 | 省略时取正文里第一个 `# 标题`，再退回文件名 |
| `date` | 否 | 省略时用文件修改时间 |
| `tags` | 否 | 字符串数组 |
| `excerpt` | 否 | 省略则自动从正文首段生成 |
| `pinned` | 否 | `true` 时置顶 |
| `updatedAt` | 否 | 不填时取 `date` |

## 日常命令

```bash
./scripts/ska.sh status     # 看服务状态和端口
./scripts/ska.sh refresh    # 清内容缓存并重启（改了内容想立刻生效）
./scripts/ska.sh rebuild    # 重新构建并重启（改了 src/ 源码后）
./scripts/ska.sh logs       # 跟踪日志
./scripts/ska.sh restart    # 重启
./scripts/ska.sh content    # 看内容 API 自检信息
./scripts/ska.sh install    # 安装 systemd 服务（开机自启）
./scripts/ska.sh uninstall  # 卸载
```

改了 `content/` 里的内容，通常**什么都不用做**：`.env` 里
`CONTENT_CACHE_TTL_MS=5000` 让目录缓存 5 秒就过期，过期后会自动后台刷新。

注意缓存是「先给旧数据再默默更新」的策略，所以刚存盘后第一次连接可能还是旧列表，
第二次就对了。想立刻生效就用 `./scripts/ska.sh refresh`。

## 连接

```bash
ssh -p 2222 任意用户名@<主机>     # 无需密码
```

## 键位

| 键 | 作用 |
| --- | --- |
| `Tab` | 在「正文 → 分类 → 友链 → AI 对话」之间切换焦点 |
| `↑`/`↓`/`j`/`k` | 焦点在正文时移动卡片，在分类/友链时切换项 |
| `Enter` | 打开文章 / 确认选择 |
| `←`/`h` | 从分类或友链回到正文 |
| `/` 或 `[` `]` | 切换文章 / 笔记 |
| `Ctrl+T` | 切换主题 |
| `Esc` | 返回首页；已在首页则断开连接 |

文章列表里打开文章需要**双击**（300ms 内两次），单击只移动焦点。

## 友链（RSS 源）按分类浏览

友链的 RSS 源也可以有自己的分类栏，配置在 `src/api/adapters/config.ts` 的
`BLOG_SOURCES` 里。以 Mint Lab 为例：

```ts
{
  id: "mintlab",
  name: "Mint Lab",
  type: "rss",
  config: {
    rssUrl: "https://www.mintlab.top/rss.xml",
    // 路径形如 /posts/{分类}/{slug}/，取第 2 段当分类
    categorySegment: "2",
    // 段数不够的（旧的扁平 URL /posts/{slug}/）归到这里
    categoryFallback: "未分类",
    // 分类显示名（JSON），没列到的分类直接用原名
    categoryLabels:
      '{"learn":"学习","talk":"杂谈","tries":"折腾"}',
  },
}
```

说明：

- `categorySegment` 是 1-based 的路径段序号。`/posts/learn/xxx/` 配 `"2"`
  得到分类 `learn`；段数不足 `N+1` 时用 `categoryFallback`
- 分类是按「该路径下文章数」从多到少排的，首个固定是「全部」，
  所以默认视图仍是完整列表，不会因为加了分类而看不到文章
- 不配置 `categorySegment` 时不会出现分类栏，RSS 里的 `<category>` 只当标签用
- 分类是拉到数据后才推导出来的，所以切换到这个源的第一瞬间可能还没有分类栏，
  之后会自动补上

配置改了要 `./scripts/ska.sh rebuild`（改了 `src/` 源码）。

`priority` 之类的排序规则不支持，分类顺序只看文章数。

## 服务说明
两个 systemd 用户服务：

- `ska-content-api.service` — 内容 API，监听 `127.0.0.1:8787`
- `ska-site-tui.service` — TUI 本体，监听 `0.0.0.0:2222`

主服务用 `Wants=`（不是 `Requires=`）依赖内容 API，因为内容 API 挂掉时
TUI 仍能靠 `.data/` 磁盘缓存启动。

`WorkingDirectory` 必须是项目根目录：`.keys/host_key`（SSH 主机密钥）和
`.data/`（内容缓存）都是相对当前目录解析的。

## 只在本机可达的接口

内容 API 只绑定 `127.0.0.1`，不对外暴露。TUI 通过 `SKA_WEB_BASE_URL` 指向它。

## 排查

**列表显示 0 篇**
```bash
curl -s http://127.0.0.1:8787/          # 看 counts
systemctl --user status ska-content-api # 看服务是否在跑
```

**改了内容看不到**
```bash
./scripts/ska.sh refresh
```

**端口冲突**
`.env` 里 `PORT` 是 TUI 的，`CONTENT_API_PORT` 是内容 API 的，两者不能相同。
Bun 会自动加载 `.env`，所以内容 API 特意用了独立的变量名。

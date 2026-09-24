---
title: 本地写作流程要解决的问题
date: 2026-09-17
tags: [写作, 本地优先, 工作流]
excerpt: 把内容源从不可达的远程 API 换成本地 markdown 目录，谈清楚这条路要解决什么。
pinned: true
---

# 为什么要在本地写

远程内容源（ska-web 的 Vercel 预览环境）在本机不可达，表现为 TUI 里「共 0 篇」。
把内容换成自己维护的 markdown 目录后：

- **不再依赖第三方服务的可用性**，断网也能看
- **写作工具自由**：Obsidian、VS Code、vim 都行，只要产出 `.md`
- **版本可控**：内容进 git，可回滚、可评审

## 关键约束

接口契约必须跟 ska-web 的 Public API v1 对齐，否则适配器解析不了。核心是四个端点：

| 端点 | 用途 |
| --- | --- |
| `GET /api/v1/posts` | 列表，游标分页 |
| `GET /api/v1/posts/{slug}` | 详情，带 `body.markdown` |
| `GET /api/v1/notes` | 笔记列表 |
| `GET /api/v1/profile` | 站点信息（「关于」页用） |

## 一个代码块测试

```bash
# 本地预览
bun run server.ts
```

```ts
const items = await parseAll(CONTENT_DIR);
console.log(`共 ${items.length} 篇`);
```

> 引用块也要能正常显示，这样才能确认 turndown 之外的 markdown 直通路径没问题。

---

最后一段，用来确认分隔线渲染。

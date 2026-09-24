---
title: 碎片笔记：几个容易忘的命令
date: 2026-09-16
tags: [笔记, 命令]
---

# 随手记

- `ss -tlnp | grep 2222` 查端口占用，比 netstat 快
- `bun hash` 文件内容做 ETag 很省事
- `systemctl --user restart xxx` 用户级服务不需要 sudo

```bash
# 看用户服务的日志
journalctl --user -u ska-site-tui -f
```

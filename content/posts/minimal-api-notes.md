---
title: 最小可用 API 的实现要点
date: 2026-09-15
tags: [bun, api, 实现]
excerpt: 用 Bun 内置能力实现一个只读的内容 API，不引入任何新依赖。
---

# 三个实现要点

## 1. frontmatter 不用装库

Bun 已内置 YAML 解析：

```ts
const { frontmatter, body } = parseFrontmatter(raw);
// Bun.YAML.parse(frontmatterYaml)
```

## 2. 游标分页照抄契约

适配器的 `fetchAllPages` 会循环请求直到 `nextCursor` 为 `null`，
所以只要最后一批返回 `nextCursor: null` 就会自然停止：

1. 读取 `limit`，默认 50
2. 用 `cursor` 当偏移量
3. 算出的偏移量超过总数就返回 `null`

## 3. 列表项不需要正文

`PostSummary` 里没有 `body` 字段，列表阶段只给元数据，
全文在详情接口才返回——这样列表请求很轻。

- 优点：列表快
- 缺点：点进文章要再发一次请求（但有 ETag 缓存兜底）

#!/usr/bin/env bun
/**
 * 本地内容 API —— 实现 ska-web Public API v1 的只读子集
 *
 * 端点：
 *   GET /api/v1/posts?limit=&cursor=   -> { items, nextCursor, total, limit }
 *   GET /api/v1/notes?limit=&cursor=   -> 同上
 *   GET /api/v1/posts/{slug}           -> PostDetail（含 body.markdown）
 *   GET /api/v1/notes/{slug}           -> 同上
 *   GET /api/v1/profile                -> Profile（「关于」页数据源）
 *
 * 内容来源：<项目根>/content/posts/*.md 与 content/notes/*.md
 * 「关于」页来自 content/profile.yml
 *
 * 每次请求都重新读盘，所以「本地存盘 → TUI 可见」不需要重启任何服务。
 *
 * 用法：
 *   bun run content              # 前台启动（端口 8787）
 *   PORT=9000 bun run content    # 换端口
 */
import { readFile, readdir, stat } from "node:fs/promises";
import { join, extname, basename, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const CONTENT_DIR = join(ROOT, "content");
// 注意：Bun 会自动加载项目根的 .env，其中 PORT 是 TUI 的端口，
// 所以这里用独立变量名，避免两者互相覆盖。
const PORT = Number(process.env.CONTENT_API_PORT ?? 8787);
const SITE_URL = (process.env.SITE_URL ?? "http://localhost:4321").replace(/\/+$/, "");
const LIMIT_MAX = 100;

type Kind = "article" | "note";

interface RawPost {
  slug: string;
  kind: Kind;
  title: string;
  excerpt: string;
  publishedAt: string;
  updatedAt: string;
  tags: { slug: string; name: string }[];
  pinned: boolean;
  markdown: string;
}

// ── frontmatter 解析（Bun 内置 YAML，无需额外依赖）───────────────────

function parseFrontmatter(raw: string): {
  data: Record<string, unknown>;
  body: string;
} {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (!m) return { data: {}, body: raw };
  let data: Record<string, unknown> = {};
  try {
    data = (Bun.YAML.parse(m[1] ?? "") as Record<string, unknown>) ?? {};
  } catch (e) {
    console.error(`  ! frontmatter YAML 解析失败: ${(e as Error).message}`);
  }
  return { data, body: m[2] ?? "" };
}

/** 取正文里第一个有实质内容的行作为摘要兜底 */
function deriveExcerpt(body: string, max = 160): string {
  for (const line of body.split("\n")) {
    const s = line.trim();
    if (
      !s ||
      s.startsWith("#") ||
      s.startsWith(">") ||
      s.startsWith("|") ||
      s.startsWith("```") ||
      s.startsWith("- ") ||
      s.startsWith("* ")
    ) {
      continue;
    }
    const plain = s.replace(/[*_`[\]]/g, "").replace(/\(.*?\)/g, "").trim();
    if (plain) return plain.length > max ? `${plain.slice(0, max)}…` : plain;
  }
  return "";
}

function toIso(value: unknown, fallback: Date): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" || typeof value === "number") {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return fallback.toISOString();
}

function normalizeTags(value: unknown): { slug: string; name: string }[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((t) => {
      if (typeof t === "string") return t.trim();
      if (t && typeof t === "object" && "name" in t) {
        return String((t as { name: unknown }).name).trim();
      }
      return "";
    })
    .filter(Boolean)
    .map((name) => ({ slug: name, name }));
}

function countWords(md: string): number {
  const text = md.replace(/```[\s\S]*?```/g, " ").replace(/[#>*_`|-]/g, " ");
  const cjk = (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
  const words = (text.match(/[A-Za-z0-9]+/g) ?? []).length;
  return cjk + words;
}

async function scanDir(dir: string, kind: Kind): Promise<RawPost[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const out: RawPost[] = [];
  for (const name of names) {
    if (extname(name) !== ".md" || name.startsWith("_") || name.startsWith(".")) {
      continue;
    }
    const full = join(dir, name);
    const info = await stat(full);
    const raw = await readFile(full, "utf-8");
    const { data, body } = parseFrontmatter(raw);
    const slug = basename(name, ".md");
    const fallbackDate = new Date(info.mtimeMs);
    const titleFromHeading = /^#\s+(.+)$/m.exec(body)?.[1]?.trim();
    out.push({
      slug,
      kind,
      title: String(data.title ?? titleFromHeading ?? slug),
      excerpt: String(data.excerpt ?? "").trim() || deriveExcerpt(body),
      publishedAt: toIso(data.date ?? data.publishedAt, fallbackDate),
      updatedAt: toIso(
        data.updatedAt ?? data.date ?? data.publishedAt,
        fallbackDate,
      ),
      tags: normalizeTags(data.tags),
      pinned: data.pinned === true,
      markdown: body.trim(),
    });
  }
  return out;
}

async function loadAll(): Promise<RawPost[]> {
  const [posts, notes] = await Promise.all([
    scanDir(join(CONTENT_DIR, "posts"), "article"),
    scanDir(join(CONTENT_DIR, "notes"), "note"),
  ]);
  const all = [...posts, ...notes];
  // 置顶优先，其次按发布时间倒序
  return all.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return Date.parse(b.publishedAt) - Date.parse(a.publishedAt);
  });
}

// ── 转为 API 形状 ────────────────────────────────────────────────────

function toSummary(p: RawPost) {
  const seg = p.kind === "article" ? "posts" : "notes";
  return {
    id: p.slug,
    slug: p.slug,
    title: p.title,
    excerpt: p.excerpt,
    kind: p.kind,
    path: `/${seg}/${p.slug}/`,
    url: `${SITE_URL}/${seg}/${p.slug}/`,
    cover: null,
    publishedAt: p.publishedAt,
    updatedAt: p.updatedAt,
    wordCount: countWords(p.markdown),
    viewCount: 0,
    tags: p.tags,
  };
}

function toDetail(p: RawPost) {
  return { ...toSummary(p), body: { format: "markdown" as const, markdown: p.markdown } };
}

function pageOf<T>(items: T[], url: URL) {
  const limit = Math.min(
    Math.max(Number(url.searchParams.get("limit") ?? 50) || 50, 1),
    LIMIT_MAX,
  );
  const cursor = Number(url.searchParams.get("cursor") ?? 0) || 0;
  const slice = items.slice(cursor, cursor + limit);
  const next = cursor + limit;
  return {
    items: slice,
    nextCursor: next < items.length ? String(next) : null,
    total: items.length,
    limit,
  };
}

// ── profile ──────────────────────────────────────────────────────────

async function loadProfile() {
  let data: Record<string, unknown> = {};
  try {
    const raw = await readFile(join(CONTENT_DIR, "profile.yml"), "utf-8");
    data = (Bun.YAML.parse(raw) as Record<string, unknown>) ?? {};
  } catch {
    // 没有 profile.yml 就用默认值
  }
  const site = (data.site ?? {}) as Record<string, unknown>;
  return {
    name: String(data.name ?? "mint"),
    role: String(data.role ?? ""),
    bio: Array.isArray(data.bio)
      ? data.bio.map(String)
      : data.bio
        ? [String(data.bio)]
        : [],
    links: Array.isArray(data.links) ? data.links : [],
    works: Array.isArray(data.works) ? data.works : [],
    site: {
      name: String(site.name ?? "local"),
      title: String(site.title ?? "本地内容源"),
      subtitle: String(site.subtitle ?? "内容来自本地 markdown 目录"),
      description: String(site.description ?? ""),
      url: String(site.url ?? SITE_URL),
    },
    aboutMd: String(data.aboutMd ?? ""),
    nowMd: String(data.nowMd ?? ""),
    updatedAt: new Date().toISOString(),
  };
}

// ── HTTP ─────────────────────────────────────────────────────────────

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

function json(data: unknown, etagSource?: string): Response {
  const headers: Record<string, string> = { ...JSON_HEADERS };
  if (etagSource !== undefined) {
    headers.etag = `W/"${Bun.hash(etagSource).toString(16)}"`;
  }
  return new Response(JSON.stringify(data), { headers });
}

function notFound(message: string): Response {
  return new Response(JSON.stringify({ error: { code: "NOT_FOUND", message } }), {
    status: 404,
    headers: JSON_HEADERS,
  });
}

const server = Bun.serve({
  port: PORT,
  hostname: "127.0.0.1",
  async fetch(req) {
    const url = new URL(req.url);
    const p = url.pathname.replace(/\/+$/, "") || "/";

    try {
      if (p === "/") {
        const all = await loadAll();
        return json({
          ok: true,
          service: "local-content-api",
          contentDir: CONTENT_DIR,
          counts: {
            posts: all.filter((x) => x.kind === "article").length,
            notes: all.filter((x) => x.kind === "note").length,
          },
        });
      }

      if (p === "/api/v1/posts" || p === "/api/v1/notes") {
        const kind: Kind = p.endsWith("posts") ? "article" : "note";
        const all = await loadAll();
        const payload = pageOf(
          all.filter((x) => x.kind === kind).map(toSummary),
          url,
        );
        return json(payload, JSON.stringify(payload.items));
      }

      const detail = /^\/api\/v1\/(posts|notes)\/(.+)$/.exec(p);
      if (detail) {
        const kind: Kind = detail[1] === "posts" ? "article" : "note";
        const slug = decodeURIComponent(detail[2]!);
        const all = await loadAll();
        const hit = all.find((x) => x.kind === kind && x.slug === slug);
        if (!hit) return notFound(`内容不存在: ${slug}`);
        return json(toDetail(hit), hit.markdown);
      }

      if (p === "/api/v1/profile") {
        const profile = await loadProfile();
        return json(profile, JSON.stringify(profile));
      }

      return notFound(`未知路径: ${p}`);
    } catch (e) {
      console.error("请求处理失败:", e);
      return new Response(
        JSON.stringify({ error: { code: "INTERNAL", message: (e as Error).message } }),
        { status: 500, headers: JSON_HEADERS },
      );
    }
  },
});

console.log(`▸ 本地内容 API 已启动: http://127.0.0.1:${server.port}`);
console.log(`  内容目录: ${CONTENT_DIR}`);

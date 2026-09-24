import ky from "ky";
import type * as types from "../types";
import type { BlogAdapter, QueryPostsParams } from "./types";
import { readCache, writeCache, readArticleCache, writeArticleCache } from "./cache";
import { RSS_ALL_CATEGORY_ID, type ContentCategory } from "../categories";
import { bumpSourcesRevision } from "./revision";

export interface RssAdapterConfig {
  rssUrl: string;
  /** 若为 true，抓取每篇文章的 HTML 页面获取全文；否则使用 description 作为 content */
  fetchFullContent?: boolean;
  /** 从 HTML 页面中提取正文的 CSS 选择器表达式（默认提取 <article>） */
  articleSelector?: string;
  /**
   * 从链接路径里推导分类：取第 N 段（1-based）。
   * 仅当路径段数 > N 时生效，否则归入 categoryFallback。
   * 例：`/posts/learn/xxx/` 配 2 → 分类 `learn`
   */
  categorySegment?: number;
  /** 分类显示名的覆盖表，JSON 字符串，如 `'{"learn":"学习"}'` */
  categoryLabels?: string;
  /** categorySegment 未命中时（比如旧的扁平 URL `/posts/xxx/`）归入的分类名 */
  categoryFallback?: string;
}

// ── RSS 解析工具 ──

function unescapeCdata(raw: string | undefined): string {
  return (raw ?? "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim();
}

function extractItems(xml: string): string[] {
  const items: string[] = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(xml))) {
    items.push(m[1] ?? "");
  }
  return items;
}

function getTag(block: string, tag: string): string {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m = re.exec(block);
  return m ? unescapeCdata(m[1] ?? "") : "";
}

function getTagRaw(block: string, tag: string): string {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m = re.exec(block);
  return m ? unescapeCdata(m[1] ?? "") : "";
}

function getTags(block: string, tag: string): string[] {
  const results: string[] = [];
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(block))) {
    results.push(unescapeCdata(m[1] ?? ""));
  }
  return results;
}

/** 解码 XML/HTML 实体 */
function decodeEntities(str: string): string {
  return str
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'");
}

function extractCoverFromHtml(html: string): string | undefined {
  const m = /<img[^>]+src=["']([^"']+)["']/i.exec(html);
  return m?.[1];
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

// ── slug / 分类推导 ──

/**
 * 根据链接路径生成文章的 name（slug）以及所属分类。
 *
 * 原来的做法是把 pathname 里的 `/` 全替换成 `_`，于是 `https://x/posts/learn/foo/`
 * 会变成 `posts_learn_foo_`（首尾都有多余下划线）。这里改成按路径分段处理，
 * 天然不会产生多余下划线。
 */
function makeNamer(config: RssAdapterConfig) {
  const segment = config.categorySegment;
  const fallback = config.categoryFallback?.trim();

  return (guid: string, link: string): { name: string; category?: string } => {
    // 旧式纯数字 URL（如 /123.html）直接用数字当 name
    const numMatch = guid.match(/\/(\d+)\.html$/);
    if (numMatch) return { name: numMatch[1] ?? "" };

    let parts: string[] = [];
    try {
      parts = new URL(link).pathname.split("/").filter(Boolean).map(safeDecode);
    } catch {
      parts = [];
    }

    if (parts.length === 0) {
      return { name: guid.replace(/[/\\]/g, "_") };
    }

    // 路径段数足够多时，才认为第 N 段是分类
    if (segment && parts.length > segment) {
      const label = parts[segment - 1];
      if (label) return { name: parts.join("_"), category: label };
    }

    return { name: parts.join("_"), category: fallback || undefined };
  };
}

function parseLabels(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  try {
    const obj = JSON.parse(raw) as unknown;
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (typeof v === "string" && v.trim()) out[k] = v.trim();
    }
    return out;
  } catch (e) {
    console.error(`  ! categoryLabels JSON 解析失败: ${(e as Error).message}`);
    return {};
  }
}

/**
 * 从已解析的文章里汇总分类列表。
 * 没配置 categorySegment 时返回空数组（此时只把 RSS 的 <category> 当标签用）。
 * 首项固定是「全部」，保证默认视图仍是完整列表。
 */
function deriveCategories(
  posts: types.PostVo[],
  config: RssAdapterConfig,
): ContentCategory[] {
  if (!config.categorySegment) return [];

  const counts = new Map<string, number>();
  for (const post of posts) {
    for (const name of post.spec?.categories ?? []) {
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }

  const labels = parseLabels(config.categoryLabels);
  const items: ContentCategory[] = [...counts.entries()]
    // 文章多的排前面；同数量按名称排，便于定位常用分类
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh"))
    .map(([key]) => ({
      id: key,
      label: labels[key] ?? key,
      listPath: "",
      detailPath: "",
      unit: "篇",
    }));

  return [
    {
      id: RSS_ALL_CATEGORY_ID,
      label: "全部",
      listPath: "",
      detailPath: "",
      unit: "篇",
    },
    ...items,
  ];
}

// ── RSS 解析 ──

function parseRssItems(
  id: string,
  name: string,
  xml: string,
  namer: ReturnType<typeof makeNamer>,
): types.PostVo[] {
  const rawItems = extractItems(xml);
  return rawItems.map((block) => {
    const title = getTag(block, "title");
    const link = getTag(block, "link");
    const guid = getTag(block, "guid");
    const pubDate = getTag(block, "pubDate");
    const author = getTag(block, "author") || name;
    const description = getTagRaw(block, "description");
    const tagCategories = getTags(block, "category");
    const contentEncoded = getTagRaw(block, "content:encoded");

    const { name: postName, category } = namer(guid || link, link);
    const cover = extractCoverFromHtml(description) ?? undefined;
    const contentRaw = decodeEntities(contentEncoded) || description;
    // 路径推导出的分类优先，同时保留 RSS 里声明的标签
    const categories = category
      ? [category, ...tagCategories.filter((c) => c !== category)]
      : tagCategories;

    return {
      metadata: {
        name: postName,
        creationTimestamp: pubDate ? new Date(pubDate).toISOString() : undefined,
      },
      spec: {
        title,
        slug: postName,
        cover: cover ?? undefined,
        deleted: false,
        publish: true,
        publishTime: pubDate ? new Date(pubDate).toISOString() : undefined,
        pinned: false,
        allowComment: true,
        visible: "PUBLIC" as const,
        priority: 0,
        excerpt: { autoGenerate: false, raw: description },
        categories,
      },
      status: {
        phase: "PUBLISHED",
        permalink: link,
        commentsCount: 0,
        excerpt: description,
      },
      content: {
        raw: contentRaw,
        content: contentRaw,
        format: "html",
      },
      owner: {
        metadata: { name: author },
        displayName: author,
      },
      categories: categories.map((cat) => ({
        metadata: { name: cat },
        spec: {
          displayName: cat,
          slug: cat,
          priority: 0,
          hidden: false,
          hideFromList: false,
        },
      })),
    } as types.PostVo;
  });
}

/** 从网络拉取 RSS 并解析 */
async function fetchAndParseRss(
  id: string,
  name: string,
  config: RssAdapterConfig,
  namer: ReturnType<typeof makeNamer>,
): Promise<types.PostVo[]> {
  const xml = await ky.get(config.rssUrl).text();
  return parseRssItems(id, name, xml, namer);
}

// ── 缓存 ──

const rssCache = new Map<string, types.PostVo[]>();
const articleHtmlCache = new Map<string, string>();
const articleCacheLoaded = new Set<string>();
const lastFetchTime = new Map<string, number>();

const CACHE_TTL_MS = 30 * 60 * 1000;

/** 从磁盘加载文章全文缓存到内存 */
function ensureArticleCacheLoaded(sourceId: string) {
  if (articleCacheLoaded.has(sourceId)) return;
  articleCacheLoaded.add(sourceId);
  const disk = readArticleCache(sourceId);
  if (disk) {
    disk.forEach((v, k) => articleHtmlCache.set(k, v));
  }
}

async function fetchArticleHtml(
  url: string,
  sourceId: string,
  selector?: string,
): Promise<string> {
  ensureArticleCacheLoaded(sourceId);
  const cached = articleHtmlCache.get(url);
  if (cached) return cached;

  const html: string = await ky.get(url).text();
  let content = html;

  if (selector) {
    const re = new RegExp(`<${selector}[^>]*>([\\s\\S]*?)<\\/${selector}>`, "i");
    const m = re.exec(html);
    if (m) content = m[1] ?? "";
  } else {
    // 默认尝试 <article>
    const articleMatch = /<article[^>]*>([\s\S]*?)<\/article>/i.exec(html);
    if (articleMatch) content = articleMatch[1] ?? "";
    else {
      const divMatch = /<div[^>]+id="article-content"[^>]*>([\s\S]*?)<\/div>/i.exec(html);
      if (divMatch) content = divMatch[1] ?? "";
    }
  }

  articleHtmlCache.set(url, content);
  // 异步写入磁盘（不阻塞返回）
  const diskCache = readArticleCache(sourceId) ?? new Map<string, string>();
  diskCache.set(url, content);
  writeArticleCache(sourceId, diskCache);
  return content;
}

export function createRssAdapter(
  id: string,
  name: string,
  config: RssAdapterConfig,
): BlogAdapter {
  const namer = makeNamer(config);
  // 分类要等拿到数据才能推导出来，所以先留空，拉取/读盘后再更新
  let discovered: readonly ContentCategory[] = [];

  /** 重新推导分类；有变化就通知 UI 重算 */
  function syncCategories(posts: types.PostVo[]) {
    const next = deriveCategories(posts, config);
    const unchanged =
      next.length === discovered.length &&
      next.every(
        (c, i) => c.id === discovered[i]?.id && c.label === discovered[i]?.label,
      );
    if (!unchanged) {
      discovered = next;
      bumpSourcesRevision();
    }
  }

  /** 后台异步刷新缓存（fire-and-forget） */
  function refreshRssCache() {
    fetchAndParseRss(id, name, config, namer)
      .then((posts) => {
        rssCache.set(id, posts);
        lastFetchTime.set(id, Date.now());
        writeCache(id, posts);
        syncCategories(posts);
      })
      .catch((e) => {
        console.error(`后台刷新 RSS 缓存失败 (${name}):`, e);
      });
  }

  const adapter: BlogAdapter = {
    id,
    name,
    type: "rss",

    /** 分类是动态发现的，用 getter 让调用方每次都能拿到最新值 */
    get categories(): readonly ContentCategory[] | undefined {
      return discovered.length > 0 ? discovered : undefined;
    },

    async queryPosts(
      params: QueryPostsParams = {},
    ): Promise<types.ListedPostVoList> {
      let posts = rssCache.get(id);

      if (!posts) {
        // 1. 尝试磁盘缓存
        const cached = readCache(id);
        if (cached) {
          posts = cached;
          rssCache.set(id, posts);
          lastFetchTime.set(id, Date.now() - CACHE_TTL_MS); // 磁盘缓存视为过期，触发后台刷新
          syncCategories(posts);
          refreshRssCache();
        } else {
          // 2. 无缓存，同步等待网络请求
          try {
            posts = await fetchAndParseRss(id, name, config, namer);
            rssCache.set(id, posts);
            lastFetchTime.set(id, Date.now());
            writeCache(id, posts);
            syncCategories(posts);
          } catch (e) {
            console.error(`RSS 拉取失败 (${name}):`, e);
            return {
              first: true,
              hasNext: false,
              hasPrevious: false,
              items: [],
              last: true,
              page: 1,
              size: 10,
              total: 0,
              totalPages: 0,
            };
          }
        }
      } else {
        // 3. 内存有缓存，检查是否过期
        const lastFetch = lastFetchTime.get(id) ?? 0;
        if (Date.now() - lastFetch > CACHE_TTL_MS) {
          console.log(`[RSS] 缓存过期 (${name}), 触发后台刷新`);
          refreshRssCache();
        }
      }

      // 按分类过滤（「全部」或未指定时不筛）
      const wanted = params.category;
      const filtered =
        !wanted || wanted === RSS_ALL_CATEGORY_ID
          ? posts
          : posts.filter((p) => p.spec?.categories?.includes(wanted));

      const page = params.page ?? 1;
      const size = params.size ?? filtered.length;
      const total = filtered.length;
      const totalPages = size > 0 ? Math.max(1, Math.ceil(total / size)) : 1;
      const start = (page - 1) * size;
      const items = size > 0 ? filtered.slice(start, start + size) : filtered;

      return {
        first: page === 1,
        hasNext: page < totalPages,
        hasPrevious: page > 1,
        items: items.map((post) => ({
          metadata: {
            name: post.metadata.name,
            creationTimestamp: post.metadata.creationTimestamp,
          },
          spec: {
            title: post.spec?.title ?? "",
            publishTime: post.spec?.publishTime,
          },
          owner: post.owner
            ? { displayName: post.owner.displayName, name: post.owner.name }
            : null,
        })),
        last: page >= totalPages,
        page,
        size: size || total,
        total,
        totalPages,
      };
    },

    async queryPostByName(name: string): Promise<types.PostVo> {
      const posts = rssCache.get(id);

      if (!posts) {
        // 触发加载
        await this.queryPosts({ page: 1, size: 1 });
        return this.queryPostByName(name);
      }

      const post = posts.find((p) => p.metadata.name === name);
      if (!post) throw new Error(`文章不存在: ${name}`);

      const link = post.status?.permalink;
      if (link && config.fetchFullContent) {
        const fullHtml = await fetchArticleHtml(link, id, config.articleSelector);
        post.content = { raw: fullHtml, content: fullHtml, format: "html" };
      }
      // 不需要 fetchFullContent 的情况（如 haoyn231），content 已在 RSS 中填充

      return post;
    },
  };

  return adapter;
}

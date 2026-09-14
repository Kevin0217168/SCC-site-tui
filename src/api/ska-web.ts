import ky, { type KyInstance } from "ky";

/** ska-web 站点根 URL（不含 /api/v1）。公开 API 目前部署在 ska-web `dev` 预览。 */
export const DEFAULT_SKA_WEB_BASE_URL =
  "https://ska-web-git-dev-sakuraofficials-projects.vercel.app";

export const SKA_WEB_API_PREFIX = "/api/v1";

export function resolveSkaWebBaseUrl(raw?: string): string {
  const fallback = DEFAULT_SKA_WEB_BASE_URL;
  const value = (raw ?? process.env.SKA_WEB_BASE_URL ?? fallback)
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/api\/v1$/i, "");
  return value || fallback;
}

// ── Public API v1 形状（docs/public-api.md）────────────────────────

export type ContentKind = "article" | "note";

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string>;
  };
}

export interface Cover {
  url: string;
  width: number;
  height: number;
}

export interface Tag {
  slug: string;
  name: string;
}

export interface PostSummary {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  kind: ContentKind;
  path: string;
  url: string;
  cover: Cover | null;
  publishedAt: string;
  updatedAt: string;
  wordCount: number;
  viewCount: number;
  tags: Tag[];
}

export interface PostDetail extends PostSummary {
  body: {
    format: "markdown";
    markdown: string;
  };
}

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
  total: number;
  limit: number;
}

export interface Friend {
  id: string;
  name: string;
  url: string;
  description: string | null;
  avatarUrl: string | null;
  sortOrder: number;
  updatedAt: string;
}

export interface FriendsResponse {
  items: Friend[];
}

export interface ProfileLink {
  label: string;
  href: string;
}

export interface ProfileWork {
  title: string;
  description: string;
  href: string;
  year: string;
  tags: string[];
}

export interface Profile {
  name: string;
  role: string;
  bio: string[];
  links: ProfileLink[];
  works: ProfileWork[];
  site: {
    name: string;
    title: string;
    subtitle: string;
    description: string;
    url: string;
  };
  aboutMd: string;
  nowMd: string;
  updatedAt: string;
}

export type SkaWebResource = "posts" | "notes" | "friends" | "about";

type CacheEntry = { etag: string; data: unknown };

const responseCache = new Map<string, CacheEntry>();
const clients = new Map<string, KyInstance>();

function getClient(baseUrl: string): KyInstance {
  let client = clients.get(baseUrl);
  if (!client) {
    client = ky.create({
      baseUrl: `${baseUrl.replace(/\/+$/, "")}/`,
      timeout: 30_000,
      throwHttpErrors: false,
      headers: { Accept: "application/json" },
    });
    clients.set(baseUrl, client);
  }
  return client;
}

function cacheKey(baseUrl: string, path: string): string {
  return `${baseUrl}/${path}`;
}

async function getJson<T>(baseUrl: string, path: string): Promise<T> {
  const client = getClient(baseUrl);
  const key = cacheKey(baseUrl, path);
  const cached = responseCache.get(key);

  const send = (etag?: string) =>
    client.get(path, {
      headers: etag ? { "If-None-Match": etag } : {},
    });

  let response = await send(cached?.etag);
  if (response.status === 304) {
    if (cached) return cached.data as T;
    response = await send();
  }

  if (!response.ok) {
    let message = `ska-web API ${response.status}`;
    try {
      const body = (await response.json()) as ApiErrorBody;
      if (body?.error?.message) message = body.error.message;
    } catch {
      // ignore parse errors
    }
    throw new Error(message);
  }

  const data = (await response.json()) as T;
  const etag = response.headers.get("etag");
  if (etag) responseCache.set(key, { etag, data });
  return data;
}

async function fetchAllPages<T>(
  baseUrl: string,
  resourcePath: string,
): Promise<T[]> {
  const items: T[] = [];
  let cursor: string | undefined;
  let pages = 0;
  const maxPages = 100;

  for (;;) {
    const search = new URLSearchParams({ limit: "50" });
    if (cursor) search.set("cursor", cursor);
    const page = await getJson<CursorPage<T>>(
      baseUrl,
      `${resourcePath}?${search.toString()}`,
    );
    items.push(...page.items);
    pages += 1;
    if (!page.nextCursor || pages >= maxPages) break;
    cursor = page.nextCursor;
  }

  return items;
}

export function createSkaWebClient(baseUrl = resolveSkaWebBaseUrl()) {
  const origin = resolveSkaWebBaseUrl(baseUrl);
  const api = SKA_WEB_API_PREFIX.replace(/^\//, "");

  return {
    origin,
    listPosts: () =>
      fetchAllPages<PostSummary>(origin, `${api}/posts`),
    getPost: (slug: string) =>
      getJson<PostDetail>(origin, `${api}/posts/${encodeURIComponent(slug)}`),
    listNotes: () =>
      fetchAllPages<PostSummary>(origin, `${api}/notes`),
    getNote: (slug: string) =>
      getJson<PostDetail>(origin, `${api}/notes/${encodeURIComponent(slug)}`),
    listFriends: async () => {
      const res = await getJson<FriendsResponse>(origin, `${api}/friends`);
      return res.items;
    },
    getProfile: () => getJson<Profile>(origin, `${api}/profile`),
  };
}

export type SkaWebClient = ReturnType<typeof createSkaWebClient>;

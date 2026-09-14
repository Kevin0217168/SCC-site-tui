import type * as types from "../types";
import type { BlogAdapter, QueryPostsParams } from "./types";
import { readCache, writeCache } from "./cache";
import {
  createSkaWebClient,
  type Friend,
  type PostDetail,
  type PostSummary,
  type Profile,
  type SkaWebClient,
  type SkaWebResource,
} from "../ska-web";

export interface SkaWebAdapterConfig {
  baseUrl: string;
  resource: SkaWebResource;
}

const CACHE_TTL_MS = 30 * 60 * 1000;

const listCache = new Map<string, types.PostVo[]>();
const lastFetchTime = new Map<string, number>();
const clients = new Map<string, SkaWebClient>();

function clientFor(baseUrl: string): SkaWebClient {
  let client = clients.get(baseUrl);
  if (!client) {
    client = createSkaWebClient(baseUrl);
    clients.set(baseUrl, client);
  }
  return client;
}

function markdownContent(markdown: string): types.ContentVo {
  return {
    raw: markdown,
    content: markdown,
    format: "markdown",
  };
}

function ownerFrom(name: string): types.ContributorVo {
  return {
    metadata: { name },
    displayName: name,
    name,
  };
}

function tagsFrom(tags: PostSummary["tags"]): types.TagVo[] {
  return tags.map((tag) => ({
    metadata: { name: tag.slug },
    spec: {
      displayName: tag.name,
      slug: tag.slug,
    },
  }));
}

function summaryToPostVo(item: PostSummary, author: string): types.PostVo {
  return {
    metadata: {
      name: item.slug,
      creationTimestamp: item.publishedAt,
    },
    spec: {
      title: item.title,
      slug: item.slug,
      cover: item.cover?.url,
      deleted: false,
      publish: true,
      publishTime: item.publishedAt,
      pinned: false,
      allowComment: true,
      visible: "PUBLIC",
      priority: 0,
      excerpt: { autoGenerate: false, raw: item.excerpt },
      tags: item.tags.map((t) => t.slug),
    },
    status: {
      phase: "PUBLISHED",
      permalink: item.url,
      excerpt: item.excerpt,
      lastModifyTime: item.updatedAt,
    },
    content: markdownContent(""),
    owner: ownerFrom(author),
    tags: tagsFrom(item.tags),
    stats: {
      visit: item.viewCount,
    },
  };
}

function detailToPostVo(item: PostDetail, author: string): types.PostVo {
  const base = summaryToPostVo(item, author);
  base.content = markdownContent(item.body?.markdown ?? "");
  return base;
}

function friendToPostVo(friend: Friend): types.PostVo {
  const description = friend.description?.trim() || "暂无简介";
  const markdown = [
    `# ${friend.name}`,
    "",
    description,
    "",
    `[${friend.url}](${friend.url})`,
  ].join("\n");

  return {
    metadata: {
      name: friend.id,
      creationTimestamp: friend.updatedAt,
    },
    spec: {
      title: friend.name,
      slug: friend.id,
      cover: friend.avatarUrl ?? undefined,
      deleted: false,
      publish: true,
      publishTime: friend.updatedAt,
      pinned: false,
      allowComment: false,
      visible: "PUBLIC",
      priority: friend.sortOrder,
      excerpt: { autoGenerate: false, raw: description },
    },
    status: {
      phase: "PUBLISHED",
      permalink: friend.url,
      excerpt: description,
      lastModifyTime: friend.updatedAt,
    },
    content: markdownContent(markdown),
    owner: ownerFrom(friend.name),
  };
}

function profileToPostVo(profile: Profile): types.PostVo {
  const bio = profile.bio.filter(Boolean).join("\n\n");
  const links = profile.links
    .map((link) => `- [${link.label}](${link.href})`)
    .join("\n");
  const works = profile.works
    .map((work) => {
      const tags = work.tags.length ? `（${work.tags.join(" · ")}）` : "";
      return `### [${work.title}](${work.href}) · ${work.year}${tags}\n\n${work.description}`;
    })
    .join("\n\n");

  const markdown = [
    `# ${profile.name || profile.site.title || "关于"}`,
    profile.role ? `\n${profile.role}\n` : "",
    bio ? `\n${bio}\n` : "",
    links ? `\n## 链接\n\n${links}\n` : "",
    works ? `\n## 作品\n\n${works}\n` : "",
    profile.aboutMd ? `\n## 关于\n\n${profile.aboutMd}\n` : "",
    profile.nowMd ? `\n## Now\n\n${profile.nowMd}\n` : "",
  ]
    .filter(Boolean)
    .join("");

  return {
    metadata: {
      name: "about",
      creationTimestamp: profile.updatedAt,
    },
    spec: {
      title: profile.site.title || profile.name || "关于",
      slug: "about",
      deleted: false,
      publish: true,
      publishTime: profile.updatedAt,
      pinned: true,
      allowComment: false,
      visible: "PUBLIC",
      priority: 0,
      excerpt: {
        autoGenerate: false,
        raw: profile.site.subtitle || profile.bio[0] || "",
      },
    },
    status: {
      phase: "PUBLISHED",
      permalink: profile.site.url,
      excerpt: profile.site.subtitle || profile.bio[0] || "",
      lastModifyTime: profile.updatedAt,
    },
    content: markdownContent(markdown),
    owner: ownerFrom(profile.name || "sAkura-io"),
  };
}

function toListed(posts: types.PostVo[], params: QueryPostsParams): types.ListedPostVoList {
  const page = params.page ?? 1;
  const size = params.size ?? posts.length;
  const total = posts.length;
  const totalPages = size > 0 ? Math.max(1, Math.ceil(total / size)) : 1;
  const start = (page - 1) * size;
  const slice = size > 0 ? posts.slice(start, start + size) : posts;

  return {
    first: page === 1,
    hasNext: page < totalPages,
    hasPrevious: page > 1,
    items: slice.map((post) => ({
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
}

async function loadCatalog(
  client: SkaWebClient,
  resource: SkaWebResource,
): Promise<types.PostVo[]> {
  if (resource === "friends") {
    const friends = await client.listFriends();
    return friends.map(friendToPostVo);
  }
  if (resource === "about") {
    const profile = await client.getProfile();
    return [profileToPostVo(profile)];
  }

  const author = await client.getProfile().then(
    (p) => p.name || p.site.name || "sAkura-io",
    () => "sAkura-io",
  );
  const items =
    resource === "notes" ? await client.listNotes() : await client.listPosts();
  return items.map((item) => summaryToPostVo(item, author));
}

function refreshCatalog(
  cacheKey: string,
  client: SkaWebClient,
  resource: SkaWebResource,
) {
  loadCatalog(client, resource)
    .then((posts) => {
      listCache.set(cacheKey, posts);
      lastFetchTime.set(cacheKey, Date.now());
      writeCache(cacheKey, posts);
    })
    .catch((err) => {
      console.error(`[ska-web] 后台刷新失败 (${resource}):`, err);
    });
}

export function createSkaWebAdapter(
  id: string,
  name: string,
  config: SkaWebAdapterConfig,
): BlogAdapter {
  const client = clientFor(config.baseUrl);
  const cacheKey = `${id}:${config.resource}`;

  return {
    id,
    name,
    type: "ska-web",
    async queryPosts(params: QueryPostsParams = {}): Promise<types.ListedPostVoList> {
      let posts = listCache.get(cacheKey);

      if (!posts) {
        const disk = readCache(cacheKey);
        if (disk) {
          posts = disk;
          listCache.set(cacheKey, posts);
          lastFetchTime.set(cacheKey, Date.now() - CACHE_TTL_MS);
          refreshCatalog(cacheKey, client, config.resource);
        } else {
          posts = await loadCatalog(client, config.resource);
          listCache.set(cacheKey, posts);
          lastFetchTime.set(cacheKey, Date.now());
          writeCache(cacheKey, posts);
        }
      } else {
        const lastFetch = lastFetchTime.get(cacheKey) ?? 0;
        if (Date.now() - lastFetch > CACHE_TTL_MS) {
          refreshCatalog(cacheKey, client, config.resource);
        }
      }

      return toListed(posts, params);
    },
    async queryPostByName(name: string): Promise<types.PostVo> {
      if (config.resource === "posts" || config.resource === "notes") {
        const detail =
          config.resource === "notes"
            ? await client.getNote(name)
            : await client.getPost(name);
        const profileName = await client.getProfile().then(
          (p) => p.name || "sAkura-io",
          () => "sAkura-io",
        );
        return detailToPostVo(detail, profileName);
      }

      let posts = listCache.get(cacheKey);
      if (!posts) {
        await this.queryPosts({ page: 1, size: 1 });
        posts = listCache.get(cacheKey) ?? [];
      }
      const post = posts.find((p) => p.metadata.name === name);
      if (!post) throw new Error(`内容不存在: ${name}`);
      return post;
    },
  };
}

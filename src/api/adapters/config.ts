import type { BlogAdapter } from "./types";
import { createSkaWebAdapter } from "./ska-web-adapter";
import { createRssAdapter } from "./rss-adapter";
import { DEFAULT_SKA_WEB_BASE_URL, resolveSkaWebBaseUrl } from "../ska-web";
import type { SkaWebResource } from "../ska-web";

export interface BlogSourceConfig {
  id: string;
  name: string;
  type: "ska-web" | "rss";
  config: Record<string, string>;
}

function skaWebSource(
  id: string,
  name: string,
  resource: SkaWebResource,
): BlogSourceConfig {
  return {
    id,
    name,
    type: "ska-web",
    config: {
      baseUrl: resolveSkaWebBaseUrl(),
      resource,
    },
  };
}

/** 所有支持的博客源配置。主站文章/笔记由分类栏切换，不占友链位。 */
export const BLOG_SOURCES: BlogSourceConfig[] = [
  skaWebSource("master", "回到主站", "posts"),
  skaWebSource("about", "关于", "about"),
  {
    id: "rss-qaqbuyan",
    name: "qaq-buyan",
    type: "rss",
    config: {
      rssUrl: "https://qaqbuyan.com:88/%E4%B9%94%E5%AE%89%E6%96%87%E7%AB%A0/rss",
      fetchFullContent: "true",
    },
  },
  {
    id: "haoyn231",
    name: "haoyn231",
    type: "rss",
    config: {
      rssUrl: "https://haoyn231.github.io/rss.xml",
    },
  },
];

/** 根据配置创建 adapter 实例 */
export function createAdapterFromConfig(source: BlogSourceConfig): BlogAdapter {
  if (source.type === "ska-web") {
    return createSkaWebAdapter(source.id, source.name, {
      baseUrl: source.config.baseUrl || DEFAULT_SKA_WEB_BASE_URL,
      resource: (source.config.resource as SkaWebResource) || "posts",
    });
  }
  return createRssAdapter(source.id, source.name, {
    rssUrl: source.config.rssUrl ?? "",
    fetchFullContent: source.config.fetchFullContent === "true",
    articleSelector: source.config.articleSelector,
  });
}

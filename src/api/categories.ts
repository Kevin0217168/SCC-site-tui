/**
 * 主站内容分类注册表。
 * 新增分类只需在 CONTENT_CATEGORIES 追加一项（id / 文案 / 列表与详情路径），
 * UI 与 ska-web 客户端会按表驱动，不必再写 if/else。
 */
export interface ContentCategory {
  id: string;
  label: string;
  /** 相对站点根，如 api/v1/posts */
  listPath: string;
  /** 须含 {slug}，如 api/v1/posts/{slug} */
  detailPath: string;
  /** 列表计数单位，默认「篇」 */
  unit?: string;
}

export const CONTENT_CATEGORIES: readonly ContentCategory[] = [
  {
    id: "posts",
    label: "文章",
    listPath: "api/v1/posts",
    detailPath: "api/v1/posts/{slug}",
    unit: "篇",
  },
  {
    id: "notes",
    label: "笔记",
    listPath: "api/v1/notes",
    detailPath: "api/v1/notes/{slug}",
    unit: "条",
  },
];

export const DEFAULT_CONTENT_CATEGORY_ID = CONTENT_CATEGORIES[0]!.id;

/**
 * RSS 源「全部」伪分类的 id。
 * RSS 的分类是拉取后从路径推导的，加一个「全部」保证默认视图仍是完整列表。
 */
export const RSS_ALL_CATEGORY_ID = "all";

export function getContentCategory(id?: string | null): ContentCategory {
  return (
    CONTENT_CATEGORIES.find((c) => c.id === id) ?? CONTENT_CATEGORIES[0]!
  );
}

export function contentCategoryIndex(id?: string | null): number {
  const idx = CONTENT_CATEGORIES.findIndex((c) => c.id === id);
  return idx >= 0 ? idx : 0;
}

/**
 * 在给定分类列表里校验 id；id 不存在（比如切换内容源后旧分类失效）
 * 时回退到第一项。列表为空则返回 undefined，表示不显示分类栏。
 */
export function resolveCategoryId(
  list: readonly ContentCategory[],
  id?: string | null,
): string | undefined {
  const first = list[0];
  if (!first) return undefined;
  return id && list.some((c) => c.id === id) ? id : first.id;
}

/** 在给定分类列表里找下标，找不到返回 0 */
export function categoryIndexIn(
  list: readonly ContentCategory[],
  id?: string | null,
): number {
  const idx = list.findIndex((c) => c.id === id);
  return idx >= 0 ? idx : 0;
}

export function resolveApiPath(path: string, params: Record<string, string> = {}): string {
  let resolved = path.replace(/^\/+/, "");
  for (const [key, value] of Object.entries(params)) {
    resolved = resolved.replaceAll(`{${key}}`, encodeURIComponent(value));
  }
  return resolved;
}

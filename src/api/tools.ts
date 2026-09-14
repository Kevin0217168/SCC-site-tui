import { tool } from "ai";
import { z } from "zod";
import { getAdapter } from "./adapters";
import { CONTENT_CATEGORIES } from "./categories";

// ── 工具定义 ────────────────────────────────────────────────────────

/**
 * 查询文章列表工具（无参数，直接返回全部文章）
 */
export const queryPostsTool = tool({
  description:
    "查询 ska 博客的全部文章与笔记列表。返回每篇的 category、name（slug）和 title；查看详情时用 queryPostByName 并传入对应 name。",
  inputSchema: z.object({}),
  execute: async () => {
    try {
      const adapter = getAdapter("master");
      const categories = adapter.categories ?? CONTENT_CATEGORIES;
      const groups = [];
      for (const cat of categories) {
        const result = await adapter.queryPosts({
          page: 1,
          size: 1000,
          category: cat.id,
        });
        groups.push({
          category: cat.id,
          label: cat.label,
          total: result.total,
          items: result.items.map((item) => ({
            category: cat.id,
            name: item.metadata.name,
            title: item.spec.title,
            publishTime: item.spec.publishTime,
            author: item.owner?.displayName ?? "未知作者",
          })),
        });
      }
      return {
        success: true,
        data: { groups },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "查询文章列表失败",
      };
    }
  },
});

// /**
//  * 按标题搜索文章工具
//  * AI 不知道文章的 metadata.name（UUID），需要先通过标题搜索获取
//  */
// export const searchPostByTitleTool = tool({
//   description:
//     "按标题关键词搜索文章，返回匹配的文章列表（包含 name 和 title）。当用户提到某篇文章的标题时，必须先用此工具搜索获取文章的 name（UUID），然后再用 queryPostByName 查询详情。",
//   inputSchema: z.object({
//     keyword: z.string().describe("文章标题的关键词或完整标题"),
//     page: z.number().optional().default(1).describe("页码，从1开始"),
//     size: z.number().optional().default(20).describe("每页数量，默认20条"),
//   }),
//   execute: async (params) => {
//     try {
//       // 获取多页文章进行标题匹配
//       const result: ListedPostVoList = await queryPosts({
//         page: params.page,
//         size: params.size,
//         sort: ["metadata.creationTimestamp,desc"],
//       });

//       const keyword = params.keyword.toLowerCase();
//       const matched = result.items.filter((item) =>
//         item.spec.title.toLowerCase().includes(keyword)
//       );

//       if (matched.length === 0 && result.totalPages > params.page) {
//         // 当前页没找到，尝试下一页
//         const nextResult = await queryPosts({
//           page: params.page + 1,
//           size: params.size,
//           sort: ["metadata.creationTimestamp,desc"],
//         });
//         const nextMatched = nextResult.items.filter((item) =>
//           item.spec.title.toLowerCase().includes(keyword)
//         );
//         matched.push(...nextMatched);
//       }

//       return {
//         success: true,
//         data: {
//           total: matched.length,
//           items: matched.map((item) => ({
//             name: item.metadata.name,
//             title: item.spec.title,
//             publishTime: item.spec.publishTime,
//             author: item.owner?.displayName ?? "未知作者",
//           })),
//           hint: matched.length > 0
//             ? "请使用返回结果中的 name 字段调用 queryPostByName 获取文章详情"
//             : "未找到匹配的文章，请尝试不同的关键词",
//         },
//       };
//     } catch (error) {
//       return {
//         success: false,
//         error: error instanceof Error ? error.message : "搜索文章失败",
//       };
//     }
//   },
// });

/**
 * 查询文章详情工具
 */
export const queryPostByNameTool = tool({
  description:
    "根据 slug（如 hello-world）查询文章或笔记的完整信息。不是标题！请先用 queryPosts 拿到 name，可选传入 category（posts / notes）。",
  inputSchema: z.object({
    name: z.string().describe("文章或笔记的 slug，例如 hello-world，绝对不是标题"),
    category: z.string().optional().describe("可选分类 id，如 posts 或 notes"),
  }),
  execute: async (params) => {
    try {
      const adapter = getAdapter("master");
      const categories = adapter.categories ?? CONTENT_CATEGORIES;
      const order = params.category
        ? [
            ...categories.filter((c) => c.id === params.category),
            ...categories.filter((c) => c.id !== params.category),
          ]
        : categories;

      let lastError: unknown;
      for (const cat of order) {
        try {
          const post = await adapter.queryPostByName(params.name, {
            category: cat.id,
          });
          return {
            success: true,
            data: {
              category: cat.id,
              name: post.metadata.name,
              title: post.spec?.title,
              slug: post.spec?.slug,
              publishTime: post.spec?.publishTime,
              visible: post.spec?.visible,
              excerpt: post.content?.raw
                ? post.content.raw.substring(0, 500) + (post.content.raw.length > 500 ? "..." : "")
                : "无摘要",
              content: post.content?.content ?? post.content?.raw ?? "无内容",
              author: post.owner?.displayName ?? "未知作者",
              categories: post.categories?.map((c) => c.spec?.displayName ?? c.metadata.name) ?? [],
              tags: post.tags?.map((t) => t.spec?.displayName ?? t.metadata.name) ?? [],
              stats: post.stats
                ? {
                    visits: post.stats.visit ?? 0,
                    comments: post.stats.comment ?? 0,
                    upvotes: post.stats.upvote ?? 0,
                  }
                : null,
            },
          };
        } catch (error) {
          lastError = error;
        }
      }
      throw lastError instanceof Error ? lastError : new Error("内容不存在");
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "查询文章详情失败",
      };
    }
  },
});

/**
 * 所有工具的集合
 */
export const blogTools = {
  queryPosts: queryPostsTool,
  // searchPostByTitle: searchPostByTitleTool,
  queryPostByName: queryPostByNameTool,
};

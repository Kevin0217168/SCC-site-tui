import { tool } from "ai";
import { z } from "zod";
import { getAdapter } from "./adapters";
import type { ListedPostVoList } from "./types";

// ── 工具定义 ────────────────────────────────────────────────────────

/**
 * 查询文章列表工具（无参数，直接返回全部文章）
 */
export const queryPostsTool = tool({
  description:
    "查询 ska 博客的全部文章列表。当用户想要浏览文章列表、查看最新文章时使用此工具。返回结果中包含每篇文章的 name（slug）和 title，如果需要查看某篇文章的详细内容，请使用 queryPostByName 工具并传入对应的 name。",
  inputSchema: z.object({}),
  execute: async () => {
    try {
      const adapter = getAdapter("master");
      const result = await adapter.queryPosts({
        page: 1,
        size: 1000,
      });
      return {
        success: true,
        data: {
          total: result.total,
          items: result.items.map((item) => ({
            name: item.metadata.name,
            title: item.spec.title,
            publishTime: item.spec.publishTime,
            author: item.owner?.displayName ?? "未知作者",
          })),
        },
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
    "根据文章的 metadata.name（slug，如 hello-world）查询单篇文章的完整信息。注意：此参数是文章的 slug，不是文章标题！请先用 queryPosts 获取文章列表，从中找到对应的 name 后再调用此工具。",
  inputSchema: z.object({
    name: z.string().describe("文章的 metadata.name / slug，例如 hello-world，绝对不是文章标题"),
  }),
  execute: async (params) => {
    try {
      const adapter = getAdapter("master");
      const post = await adapter.queryPostByName(params.name);
      return {
        success: true,
        data: {
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

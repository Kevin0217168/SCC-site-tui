import type { ListedPostVoList, PostVo } from "../types";
import type { ContentCategory } from "../categories";

export interface QueryPostsParams {
  page?: number;
  size?: number;
  category?: string;
}

export interface QueryPostParams {
  category?: string;
}

export interface BlogAdapter {
  id: string;
  name: string;
  type: "ska-web" | "rss";
  /** 主站内容分类；有值时 TUI 显示分类栏。RSS / 友链 / 关于为空。 */
  categories?: readonly ContentCategory[];
  queryPosts(params?: QueryPostsParams): Promise<ListedPostVoList>;
  queryPostByName(name: string, params?: QueryPostParams): Promise<PostVo>;
}

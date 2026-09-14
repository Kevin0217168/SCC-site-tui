import type { ListedPostVo } from "../api/types";
import { getAdapter } from "../api/adapters";
import { htmlToMarkdown } from "./htmlToMarkdown";

export async function postToMarkdown(
  post: ListedPostVo,
  sourceId: string = "master",
): Promise<string> {
  const adapter = getAdapter(sourceId);
  const detail = await adapter.queryPostByName(post.metadata.name);
  const body = detail.content?.content ?? detail.content?.raw;
  if (!body) return "";
  if (detail.content?.format === "markdown") return body;
  if (detail.content?.format === "html") return htmlToMarkdown(body);
  return body;
}

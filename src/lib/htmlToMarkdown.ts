import TurndownService from "turndown";
// @ts-ignore 插件没有自带类型声明
import { gfm } from "turndown-plugin-gfm";

const turndownService = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
});

turndownService.use(gfm);

turndownService.addRule("fencedCodeBlock", {
  filter: function (node): boolean {
    return (
      node.nodeName === "PRE" &&
      !!node.firstChild &&
      node.firstChild.nodeName === "CODE"
    );
  },
  replacement: function (_content, node) {
    const codeElem = node.firstChild as HTMLElement;
    const className = codeElem.getAttribute("class") || "";
    const language = className.replace(/language-/, "");
    return `\n\`\`\`${language}\n${codeElem.textContent}\n\`\`\`\n`;
  },
});

/** 仅给仍返回 HTML 的 RSS 源使用。ska-web API v1 已是 markdown。 */
export function htmlToMarkdown(html: string): string {
  return turndownService.turndown(html);
}

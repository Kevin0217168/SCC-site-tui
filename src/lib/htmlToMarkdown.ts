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

/**
 * turndown 会把文本里的 `[` `]` 转义成 `\[` `\]`，因为方括号在 markdown 里
 * 属于链接语法。但对 Astro 的容器语法（`:::note[背景]`）来说这是多余的，
 * 在终端里会显示成 `:::note\[背景\]`，很难看。
 *
 * 这里把它们还原，但**跳过围栏代码块**，避免破坏代码里的字面反斜杠。
 */
function unescapeBrackets(markdown: string): string {
  const codeFence = /(```[\s\S]*?```|~~~[\s\S]*?~~~)/g;
  return markdown
    .split(codeFence)
    .map((segment, i) => {
      // 带捕获组 split 后，奇数下标是围栏代码块，原样保留
      if (i % 2 === 1) return segment;
      return segment.replace(/\\\[/g, "[").replace(/\\\]/g, "]");
    })
    .join("");
}

/** 仅给仍返回 HTML 的 RSS 源使用。ska-web API v1 已是 markdown。 */
export function htmlToMarkdown(html: string): string {
  return unescapeBrackets(turndownService.turndown(html));
}

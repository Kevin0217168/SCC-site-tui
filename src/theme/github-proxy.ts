/**
 * GitHub 资源代理 —— 让墙内服务器也能拉取 tree-sitter 的 wasm 与查询文件。
 *
 * `parsers-config.ts` 里的语法资产默认托管在 github.com 与
 * raw.githubusercontent.com。国内机房直连 github.com:443 会直接超时
 * （实测 MintServer-SH 12s 无响应），后果是代码块高亮失效，
 * 且每个语言首次渲染时都会先卡一次网络超时。
 *
 * 在 `.env` 里设置 GH_PROXY 即可把所有 GitHub 链接改写成走代理：
 *
 *   GH_PROXY=https://gh-proxy.com/
 *
 * 留空则完全不做改写，本地开发不受任何影响。
 */

/** 会被改写的源站前缀 */
const GITHUB_URL_PREFIXES = [
  "https://github.com/",
  "https://raw.githubusercontent.com/",
];

/** 把 `https://gh-proxy.com` 规范成 `https://gh-proxy.com/`；空值返回 undefined */
export function normalizeProxy(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
}

function isGithubUrl(value: string): boolean {
  return GITHUB_URL_PREFIXES.some((prefix) => value.startsWith(prefix));
}

function walk(value: unknown, prefix: string): unknown {
  if (typeof value === "string") {
    return isGithubUrl(value) ? prefix + value : value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => walk(item, prefix));
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, val]) => [
        key,
        walk(val, prefix),
      ]),
    );
  }
  return value;
}

/**
 * 深度遍历配置对象，把其中的 GitHub URL 换成「代理前缀 + 原 URL」。
 *
 * 只改字符串，其余类型原样返回，所以改完的结果仍然满足
 * `addFiletypeParser()` 的类型要求，不需要动 OpenTUI 的类型定义。
 * 代理未配置时原样返回入参。
 */
export function rewriteGithubUrls<T>(
  value: T,
  proxy: string | undefined = process.env.GH_PROXY,
): T {
  const prefix = normalizeProxy(proxy);
  if (!prefix) return value;
  return walk(value, prefix) as T;
}

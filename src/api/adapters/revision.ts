import { createSignal } from "solid-js";

/**
 * 内容源「分类列表」的版本号。
 *
 * RSS 源的分类是**拉取之后**才推导出来的（要从链接路径里取分段），
 * 而 `adapter.categories` 是个普通属性、不是信号，UI 的 memo 追踪不到它的变化。
 * 所以适配器发现分类后 bump 这个信号，UI 只要在 memo 里读一下它就能重算。
 */
const [revision, setRevision] = createSignal(0);

/** 读取当前版本号（在 memo/effect 里读即可订阅变更） */
export const sourcesRevision = revision;

/** 由适配器在分类列表变化时调用 */
export function bumpSourcesRevision(): void {
  setRevision((n) => n + 1);
}

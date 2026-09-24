/** @jsxImportSource @opentui/solid */
import { For, Show, onMount, onCleanup, createEffect, createMemo } from "solid-js";
import { TextAttributes } from "@opentui/core";
import { useTheme } from "../context/ThemeContext";
import { useRenderer } from "@opentui/solid";
import { useFocusGroup, useFocusManager } from "../context/FocusContext";
import { useDialog } from "../ui/dialog";
import { usePostContext } from "../context/PostContext";
import { categoryIndexIn, resolveCategoryId } from "../api/categories";
import { getAdapter } from "../api/adapters";
import { sourcesRevision } from "../api/adapters/revision";

/** 右侧栏「友链」上方的分类块，样式与友链一致。 */
export function CategoryColumn() {
  const { theme } = useTheme();
  const renderer = useRenderer();
  const dialog = useDialog();
  const { activateGroup, _setFocusedIndex, activeGroup } = useFocusManager();
  const { focusedIndex, isActive } = useFocusGroup("category");
  const {
    currentSource,
    currentCategory,
    setCurrentCategory,
    showPost,
    setShowPost,
  } = usePostContext();

  // 分类由当前内容源提供：主站是「文章/笔记」，RSS 源是从链接路径推导出来的
  const cats = createMemo(() => {
    // 订阅分类版本号（RSS 源的分类要拉取之后才推导出来）
    sourcesRevision();
    try {
      return getAdapter(currentSource()).categories ?? [];
    } catch {
      return [];
    }
  });

  /** 当前生效的分类 id；切换内容源后旧分类失效时会回退到第一项 */
  const activeId = createMemo(() =>
    resolveCategoryId(cats(), currentCategory()),
  );

  createEffect(() => {
    _setFocusedIndex("category", categoryIndexIn(cats(), currentCategory()));
  });

  function selectIndex(idx: number, moveToList = false) {
    const cat = cats()[idx];
    if (!cat) return;
    _setFocusedIndex("category", idx);
    if (currentCategory() !== cat.id) {
      setShowPost(null);
      setCurrentCategory(cat.id);
    }
    if (moveToList) activateGroup("main");
  }

  function cycle(delta: number) {
    const list = cats();
    if (list.length === 0) return;
    const next =
      (categoryIndexIn(list, currentCategory()) + delta + list.length) %
      list.length;
    selectIndex(next);
  }

  const handleKey = (key: {
    name?: string;
    ctrl?: boolean;
    sequence?: string;
  }) => {
    if (key.ctrl) return;
    if (dialog.stack.length > 0) return;
    // 焦点在 AI 输入框或友链列表时，不处理分类栏按键
    if (activeGroup() === "sidebar" || activeGroup() === "friends") return;
    if (showPost() != null && !isActive()) return;

    const name = key.name || key.sequence || "";
    if (name === "[" || name === "{") {
      cycle(-1);
      return;
    }
    if (name === "]" || name === "}") {
      cycle(1);
      return;
    }

    if (!isActive()) return;

    const list = cats();
    if (list.length === 0) return;

    const digit = name.length === 1 ? name.charCodeAt(0) - 48 : -1;
    if (digit >= 1 && digit <= list.length) {
      selectIndex(digit - 1, true);
      return;
    }

    let newIdx = focusedIndex();
    if (name === "down" || name === "j") {
      newIdx = (newIdx + 1) % list.length;
      selectIndex(newIdx);
    } else if (name === "up" || name === "k") {
      newIdx = (newIdx - 1 + list.length) % list.length;
      selectIndex(newIdx);
    } else if (
      name === "return" ||
      name === "enter" ||
      name === "left" ||
      name === "h"
    ) {
      selectIndex(newIdx, true);
    }
  };

  onMount(() => {
    renderer.keyInput.on("keypress", handleKey);
  });
  onCleanup(() => {
    renderer.keyInput.removeListener("keypress", handleKey);
  });

  return (
    <Show when={cats().length > 0}>
      <box
        title=" 分类 "
        titleColor={isActive() ? theme.accent : "#5cb66b"}
        style={{
          border: true,
          borderColor: isActive() ? theme.accent : theme.text,
          flexShrink: 0,
          paddingX: 1,
        }}
      >
        <For each={cats()}>
          {(cat, index) => {
            const selected = () => activeId() === cat.id;
            const focused = () => isActive() && focusedIndex() === index();
            return (
              <text
                style={{
                  alignSelf: "center",
                  fg: focused()
                    ? theme.accent
                    : selected()
                      ? "#5cb66b"
                      : theme.text,
                  attributes: selected() ? TextAttributes.BOLD : undefined,
                }}
                onMouseDown={() => selectIndex(index())}
              >
                {selected()
                  ? `▸ ${index() + 1} ${cat.label}`
                  : `  ${index() + 1} ${cat.label}`}
              </text>
            );
          }}
        </For>
        <text
          style={{
            alignSelf: "center",
            fg: theme.textMuted,
            attributes: TextAttributes.DIM,
          }}
        >
          [/] 切换
        </text>
      </box>
    </Show>
  );
}

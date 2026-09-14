/** @jsxImportSource @opentui/solid */
import { For, onMount, onCleanup, createEffect } from "solid-js";
import { TextAttributes } from "@opentui/core";
import { useTheme } from "../context/ThemeContext";
import { useRenderer } from "@opentui/solid";
import { useFocusGroup, useFocusManager } from "../context/FocusContext";
import { useDialog } from "../ui/dialog";
import { usePostContext } from "../context/PostContext";
import {
  CONTENT_CATEGORIES,
  contentCategoryIndex,
} from "../api/categories";

const MASTER_SOURCE = "master";

/** 右侧栏「友链」上方的分类块，样式与友链一致。 */
export function CategoryColumn() {
  const { theme } = useTheme();
  const renderer = useRenderer();
  const dialog = useDialog();
  const { activateGroup, _setFocusedIndex, activeGroup } = useFocusManager();
  const { focusedIndex, isActive } = useFocusGroup("category");
  const {
    currentSource,
    setCurrentSource,
    currentCategory,
    setCurrentCategory,
    showPost,
    setShowPost,
  } = usePostContext();

  const cats = () => CONTENT_CATEGORIES;

  createEffect(() => {
    _setFocusedIndex("category", contentCategoryIndex(currentCategory()));
  });

  function selectIndex(idx: number, moveToList = false) {
    const cat = cats()[idx];
    if (!cat) return;
    _setFocusedIndex("category", idx);
    if (currentSource() !== MASTER_SOURCE) {
      setShowPost(null);
      setCurrentSource(MASTER_SOURCE);
    }
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
      (contentCategoryIndex(currentCategory()) + delta + list.length) %
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
    if (activeGroup() === "sidebar") return;
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

  const onMaster = () => currentSource() === MASTER_SOURCE;

  return (
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
          const selected = () => onMaster() && currentCategory() === cat.id;
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
  );
}

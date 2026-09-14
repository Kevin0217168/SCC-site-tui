/** @jsxImportSource @opentui/solid */
import { For, onMount, onCleanup, createEffect } from "solid-js";
import { TextAttributes } from "@opentui/core";
import { useTheme } from "../context/ThemeContext";
import { useRenderer } from "@opentui/solid";
import { useFocusGroup, useFocusManager } from "../context/FocusContext";
import { useDialog } from "../ui/dialog";
import { usePostContext } from "../context/PostContext";
import {
  contentCategoryIndex,
  type ContentCategory,
} from "../api/categories";

interface CategoryColumnProps {
  categories: readonly ContentCategory[];
}

export function CategoryColumn(props: CategoryColumnProps) {
  const { theme } = useTheme();
  const renderer = useRenderer();
  const dialog = useDialog();
  const { activateGroup, _setFocusedIndex, activeGroup } = useFocusManager();
  const { focusedIndex, isActive } = useFocusGroup("category");
  const { currentCategory, setCurrentCategory, showPost, setShowPost } =
    usePostContext();

  const cats = () => props.categories;

  createEffect(() => {
    _setFocusedIndex("category", contentCategoryIndex(currentCategory()));
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
    const next = (contentCategoryIndex(currentCategory()) + delta + list.length) % list.length;
    selectIndex(next);
  }

  const handleKey = (key: { name?: string; ctrl?: boolean; sequence?: string }) => {
    if (key.ctrl) return;
    if (dialog.stack.length > 0) return;
    if (showPost() != null) return;
    if (activeGroup() === "sidebar") return;

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
      name === "right" ||
      name === "l"
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
    <box
      style={{
        flexShrink: 0,
        width: 16,
        flexDirection: "column",
        height: "100%",
        padding: 0,
        margin: 0,
      }}
    >
      <box
        title=" 分类 "
        titleColor={isActive() ? theme.accent : "#5cb66b"}
        style={{
          border: true,
          borderColor: isActive() ? theme.accent : theme.borderSubtle,
          flexGrow: 1,
          paddingX: 1,
        }}
      >
        <For each={cats()}>
          {(cat, index) => {
            const selected = () => currentCategory() === cat.id;
            const focused = () => isActive() && focusedIndex() === index();
            return (
              <text
                style={{
                  fg: focused()
                    ? theme.accent
                    : selected()
                      ? "#5cb66b"
                      : theme.text,
                  attributes: selected() ? TextAttributes.BOLD : undefined,
                }}
                onMouseDown={() => selectIndex(index(), true)}
              >
                {selected() ? `▸ ${index() + 1} ${cat.label}` : `  ${index() + 1} ${cat.label}`}
              </text>
            );
          }}
        </For>
        <text style={{ fg: theme.textMuted, attributes: TextAttributes.DIM }}>
          [/] 切换
        </text>
      </box>
    </box>
  );
}

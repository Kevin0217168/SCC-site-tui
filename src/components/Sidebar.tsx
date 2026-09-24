/** @jsxImportSource @opentui/solid */
import { Show, createEffect, onCleanup, onMount } from "solid-js";
import { useRenderer } from "@opentui/solid";
import { TextAttributes } from "@opentui/core";
import { useTheme } from "../context/ThemeContext";
import { usePostContext } from "../context/PostContext";
import { AIChat } from "./AIChat";
import { CategoryColumn } from "./CategoryColumn";
import { formatDate } from "../lib/date";
import { useSession } from "../context/SessionContext";
import { useFocusGroup, useFocusManager } from "../context/FocusContext";
import { useDialog } from "../ui/dialog";
import { getBlogSourceList } from "../api/adapters";

const aiChatEnabled = () =>
  !!(process.env.AI_BASE_URL && process.env.AI_API_KEY && process.env.AI_MODEL);

/** 「友链」的焦点组 ID。独立于 sidebar，避免和 AI 输入框抢按键 */
const FRIENDS_GROUP = "friends";

export function Sidebar({ width }: { width: number | `${number}%` }) {
  const { theme } = useTheme();
  const { currentSource, setCurrentSource, showPost, setShowPost } =
    usePostContext();
  const session = useSession();
  const blogSources = getBlogSourceList();
  const { isActive } = useFocusGroup("sidebar");
  const renderer = useRenderer();
  const dialog = useDialog();
  const { activateGroup, _setFocusedIndex } = useFocusManager();
  // 友链列表的键盘焦点状态
  const { focusedIndex, isActive: isFriendsActive } =
    useFocusGroup(FRIENDS_GROUP);

  const sourceIndexOf = (id: string) => {
    const i = blogSources.findIndex((s) => s.id === id);
    return i >= 0 ? i : 0;
  };

  /** 当前键盘光标位置（钳制到合法范围） */
  function cursor(): number {
    const n = blogSources.length;
    if (n === 0) return 0;
    return Math.min(Math.max(focusedIndex(), 0), n - 1);
  }

  /** 选中第 idx 个内容源 */
  function selectSource(idx: number) {
    const src = blogSources[idx];
    if (!src) return;
    _setFocusedIndex(FRIENDS_GROUP, idx);
    if (currentSource() === src.id) return;
    setTimeout(() => setCurrentSource(src.id), 0);
  }

  // 内容源变化时同步键盘光标，避免 Tab 进来时位置对不上
  createEffect(() => {
    _setFocusedIndex(FRIENDS_GROUP, sourceIndexOf(currentSource()));
  });

  // ── 键盘导航：上/下/j/k 切换友链，Enter 选中，左/h 回到正文 ──
  const handleKey = (key: {
    name?: string;
    ctrl?: boolean;
    sequence?: string;
  }) => {
    if (key.ctrl) return;
    if (dialog.stack.length > 0) return;
    if (!isFriendsActive()) return;

    const n = blogSources.length;
    if (n === 0) return;

    const name = key.name || key.sequence || "";
    const idx = cursor();

    if (name === "down" || name === "j") {
      selectSource((idx + 1) % n);
    } else if (name === "up" || name === "k") {
      selectSource((idx - 1 + n) % n);
    } else if (name === "return" || name === "enter" || name === "space") {
      setShowPost(null);
      selectSource(idx);
    } else if (name === "left" || name === "h") {
      activateGroup("main");
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
        flexGrow: 1,
        flexShrink: 0,
        width: width,
        flexDirection: "column",
        backgroundColor: theme.background,
        alignItems: "stretch",
        justifyContent: "flex-start",
        margin: 0,
        padding: 0,
      }}
    >
      <box
        style={{
          border: true,
        }}
        title=" STATUS "
        titleColor="#5cb66b"
        flexShrink={0}
        paddingX={1}
      >
        <Show when={showPost() != null}>
          <text>当前文章：{showPost()?.spec?.title || "无名"}</text>
          <text>
            更新时间：
            {formatDate(showPost()?.spec?.publishTime)}
          </text>
        </Show>
        <Show when={showPost() == null}>
          <text>当前位置：首页</text>
          <text>当前用户：{session.username}</text>
        </Show>
      </box>
      <CategoryColumn />
      <box
        style={{
          border: true,
          borderColor: isFriendsActive() ? theme.accent : theme.text,
        }}
        title=" 友链 "
        titleColor={isFriendsActive() ? theme.accent : "#5cb66b"}
        flexShrink={0}
        paddingX={1}
      >
        {blogSources.map((source, i) => (
          <text
            style={{
              alignSelf: "center",
              fg:
                currentSource() === source.id
                  ? "#5cb66b"
                  : isFriendsActive() && cursor() === i
                    ? theme.accent
                    : theme.text,
              bg:
                isFriendsActive() && cursor() === i
                  ? theme.backgroundElement
                  : undefined,
              attributes:
                isFriendsActive() && cursor() === i
                  ? TextAttributes.BOLD
                  : undefined,
            }}
            onMouseDown={() => {
              setShowPost(null);
              selectSource(i);
            }}
          >
            {currentSource() === source.id ? `▸ ${source.name}` : source.name}
          </text>
        ))}
      </box>
      <Show when={aiChatEnabled()}>
        <box
          style={{
            border: true,
            borderColor: isActive() ? "#58A6FF" : theme.text,
          }}
          title=" AI Chat "
          titleColor={isActive() ? "#58A6FF" : "#58A6FF"}
          flexShrink={1}
        >
          <AIChat />
        </box>
      </Show>
    </box>
  );
}

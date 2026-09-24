/** @jsxImportSource @opentui/solid */
import { createResource, createEffect, Show, createMemo } from "solid-js";
import { useTheme } from "../context/ThemeContext";
import { PostList } from "./PostList";
import { getAdapter } from "../api/adapters";
import { GifPlayer } from "./GifPlayer";
// @ts-ignore
import gifSrc from "../assets/doro.gif" with { type: "image/gif" };
// @ts-ignore
import gifSr2 from "../assets/9f2ffeefda81a1841f40adb3f225958e.gif" with { type: "image/gif" };
import type { ListedPostVo } from "../api/types";
import PostDetail from "./PostDetail";
import { useChat } from "../context/ChatContext";
import { usePostContext } from "../context/PostContext";
import { postToMarkdown } from "../lib/postToMarkdown";
import { useSession } from "../context/SessionContext";
import { TextAttributes } from "@opentui/core";
import { resolveCategoryId } from "../api/categories";
import { sourcesRevision } from "../api/adapters/revision";
import { useFocusGroup, useFocusManager } from "../context/FocusContext";

export function MainContent() {
  const { theme } = useTheme();
  const chat = useChat();
  const {
    currentSource,
    currentCategory,
    showPost,
    setShowPost,
  } = usePostContext();
  const session = useSession();
  const { activateGroup, _setFocusedIndex } = useFocusManager();
  useFocusGroup("main");

  const categories = createMemo(() => {
    // 订阅分类版本号：RSS 源的分类是拉到数据之后才推导出来的
    sourcesRevision();
    try {
      return getAdapter(currentSource()).categories ?? [];
    } catch {
      return [];
    }
  });

  /** 当前生效的分类 id；切换内容源后旧分类失效时会回退到第一项 */
  const activeCategoryId = createMemo(() =>
    resolveCategoryId(categories(), currentCategory()),
  );

  const activeCategory = createMemo(() => {
    const id = activeCategoryId();
    return id ? categories().find((c) => c.id === id) : undefined;
  });

  const [posts] = createResource(
    () => ({ sourceId: currentSource(), category: activeCategoryId() }),
    async ({ sourceId, category }) => {
      const adapter = getAdapter(sourceId);
      return adapter.queryPosts({ page: 1, size: undefined, category });
    },
  );

  createEffect(() => {
    currentCategory();
    _setFocusedIndex("main", 0);
  });

  // 当 showPost 变化时，更新 AI 上下文
  createEffect(() => {
    const post = showPost();
    const sourceId = currentSource();
    const categoryId = activeCategoryId();
    if (post) {
      postToMarkdown(post, sourceId, categoryId).then((md) => {
        if (currentSource() !== sourceId || showPost()?.metadata.name !== post.metadata.name) return;
        const title = post.spec?.title ?? "Untitled";
        chat.setContext(
          `post:${post.metadata.name}`,
          `[Context: 当前正在阅读${activeCategory()?.label ?? "文章"}。详细信息： "${title}"]\n\n${md}`,
        );
      });
    } else {
      const items = posts()?.items;
      if (items && items.length > 0) {
        const kind = activeCategory()?.label ?? "内容";
        const list = items
          .map(
            (p, i) =>
              `${i + 1}. ${p.spec?.title ?? "Untitled"} (${p.metadata.name})`,
          )
          .join("\n");
        chat.setContext(
          "home",
          `[Context: 当前在首页，${kind}列表如下]\n\n${list}`,
        );
      }
    }
  });

  const handlePostClick = (post: ListedPostVo) => {
    setShowPost(post);
  };

  const handleClosePost = () => {
    setShowPost(null);
  };

  return (
    <box
      style={{
        height: "100%",
        width: "100%",
        flexDirection: "column",
        justifyContent: "flex-start",
        alignItems: "center",
        flexGrow: 3,
        gap: 0,
      }}
    >
      {/* ── 列表头 ── */}
      <box
        style={{
          width: "100%",
          flexDirection: "row",
          // 终端不够宽时自动折成两行，避免右侧提示被裁掉
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          columnGap: 2,
          paddingBottom: 1,
          paddingX: 3,
        }}
      >
        <text
          onMouseDown={() => {
            if (showPost() == null) {
              session.endSession();
              return;
            }
            setShowPost(null);
          }}
        >
          {showPost() == null ? "[ESC] 断开连接" : "[ESC] 返回首页"}
        </text>
        <Show when={showPost() == null}>
          <text style={{ fg: theme.accent, attributes: TextAttributes.BOLD }}>
            ✦ {activeCategory()?.label ?? "文章"}列表
          </text>
        </Show>
        <Show when={showPost() == null}>
          <text style={{ fg: theme.textMuted }}>
            共 {posts()?.total ?? 0} {activeCategory()?.unit ?? "篇"}
          </text>
        </Show>
        <Show when={showPost() != null}>
          <text>
            {(showPost()?.spec?.title ?? "Untitled").slice(0, 20)}
            {(showPost()?.spec?.title ?? "").length > 20 ? "…" : ""}
          </text>
        </Show>

        <text>{"[ / ] 分类   [Ctrl+T] 主题"}</text>
      </box>
      <Show when={showPost() != null}>
        <PostDetail
          handleClose={handleClosePost}
          post={showPost() as ListedPostVo}
          sourceId={currentSource()}
          categoryId={activeCategoryId()}
        />
      </Show>
      <Show when={showPost() == null}>
        <Show
          when={!posts.error}
          fallback={
            <text style={{ fg: theme.error || "#ff5555" }}>
              {" "}
              加载失败: {posts.error?.message || "未知网络错误"}
            </text>
          }
        >
          <Show
            when={!posts.loading && posts()}
            fallback={
              <text style={{ fg: theme.textMuted }}>
                {" "}
                正在从 ska-web 读取{activeCategory()?.label ?? "内容"}...
              </text>
            }
          >
            {(data) => (
              <PostList
                posts={data().items ?? []}
                enterPost={handlePostClick}
                emptyText={`暂无${activeCategory()?.label ?? "内容"}`}
                onLeaveToCategories={() => activateGroup("category")}
              />
            )}
          </Show>
        </Show>
      </Show>
    </box>
  );
}

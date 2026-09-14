/** @jsxImportSource @opentui/solid */
import { createContext, useContext, createSignal, type JSX } from "solid-js";
import type { ListedPostVo } from "../api/types";
import { DEFAULT_CONTENT_CATEGORY_ID } from "../api/categories";

interface PostContextValue {
  currentSource: () => string;
  setCurrentSource: (id: string) => void;
  currentCategory: () => string;
  setCurrentCategory: (id: string) => void;
  showPost: () => ListedPostVo | null;
  setShowPost: (post: ListedPostVo | null) => void;
}

const PostContext = createContext<PostContextValue>();

export function PostProvider(props: { children: JSX.Element }) {
  const [currentSource, setCurrentSource] = createSignal<string>("master");
  const [currentCategory, setCurrentCategory] = createSignal<string>(
    DEFAULT_CONTENT_CATEGORY_ID,
  );
  const [showPost, setShowPost] = createSignal<ListedPostVo | null>(null);

  return (
    <PostContext.Provider
      value={{
        currentSource,
        setCurrentSource,
        currentCategory,
        setCurrentCategory,
        showPost,
        setShowPost,
      }}
    >
      {props.children}
    </PostContext.Provider>
  );
}

export function usePostContext() {
  const ctx = useContext(PostContext);
  if (!ctx) throw new Error("usePostContext must be used within a PostProvider");
  return ctx;
}

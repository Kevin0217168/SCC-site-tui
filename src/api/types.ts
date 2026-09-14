// TUI 视图模型（沿用原 Halo VO 字段名，由各 adapter 映射而来）
export interface QueryPostsParams {
  page?: number;
  size?: number;
  labelSelector?: string[];
  fieldSelector?: string[];
  sort?: string[];
}

// 列表结构（字段名沿用原 Halo ListedPostVoList，供 UI 使用）
export interface ListedPostVoList {
  first: boolean;
  hasNext: boolean;
  hasPrevious: boolean;
  items: ListedPostVo[]; // 文章数组
  last: boolean;
  page: number;
  size: number;
  total: number;       // 总条数
  totalPages: number;
}

// 单篇文章的结构
export interface ListedPostVo {
  metadata: {
    name: string;
    creationTimestamp?: string | null;
  };
  spec: {
    title: string;
    publishTime?: string;
  };
  owner?: {
    displayName?: string;
    name?: string;
  } | null;
}

// ===== queryPostByName 接口相关类型 =====

// Metadata（通用元数据）
export interface Metadata {
  name: string;
  annotations?: Record<string, string>;
  creationTimestamp?: string | null;
  deletionTimestamp?: string | null;
  finalizers?: (string | null)[] | null;
  generateName?: string;
  labels?: Record<string, string>;
  version?: number | null;
}

// PostSpec（文章规格）
export interface PostSpec {
  title: string;
  slug: string;
  template?: string;
  cover?: string;
  deleted: boolean;
  publish: boolean;
  publishTime?: string;
  pinned: boolean;
  allowComment: boolean;
  visible: 'PUBLIC' | 'INTERNAL' | 'PRIVATE';
  priority: number;
  excerpt: Excerpt;
  headSnapshot?: string;
  baseSnapshot?: string;
  releaseSnapshot?: string;
  owner?: string;
  categories?: string[];
  tags?: string[];
  htmlMetas?: Record<string, string>[];
}

// Excerpt（摘要）
export interface Excerpt {
  autoGenerate: boolean;
  raw?: string;
}

// PostStatus（文章状态）
export interface PostStatus {
  phase?: string;
  permalink?: string;
  inProgress?: boolean;
  commentsCount?: number;
  contributors?: string[];
  excerpt?: string;
  hideFromList?: boolean;
  lastModifyTime?: string;
  observedVersion?: number;
}

// ContentVo（内容）。ska-web 已是 markdown；RSS 等源可能仍是 html。
export interface ContentVo {
  raw?: string;
  content?: string;
  format?: "markdown" | "html";
}

// ContributorVo（贡献者/作者）
export interface ContributorVo {
  metadata: Metadata;
  name?: string;
  displayName?: string;
  avatar?: string;
  bio?: string;
  permalink?: string;
}

// CategoryVo（分类）
export interface CategoryVo {
  metadata: Metadata;
  spec?: CategorySpec;
  status?: CategoryStatus;
  postCount?: number;
}

// CategorySpec
export interface CategorySpec {
  displayName: string;
  slug: string;
  cover?: string;
  description?: string;
  template?: string;
  priority: number;
  hidden: boolean;
  hideFromList: boolean;
  parentName?: string;
}

// CategoryStatus
export interface CategoryStatus {
  permalink?: string;
  conditions?: any[];
}

// TagVo（标签）
export interface TagVo {
  metadata: Metadata;
  spec?: TagSpec;
  status?: TagStatus;
  postCount?: number;
}

// TagSpec
export interface TagSpec {
  displayName: string;
  slug: string;
  color?: string;
  cover?: string;
  description?: string;
}

// TagStatus
export interface TagStatus {
  permalink?: string;
  conditions?: any[];
}

// StatsVo（统计）
export interface StatsVo {
  visit?: number;
  comment?: number;
  upvote?: number;
}

// PostVo（文章完整信息，queryPostByName 的返回类型）
export interface PostVo {
  metadata: Metadata;
  spec?: PostSpec;
  status?: PostStatus;
  content?: ContentVo;
  owner?: ContributorVo;
  categories?: CategoryVo[];
  tags?: TagVo[];
  contributors?: ContributorVo[];
  stats?: StatsVo;
}
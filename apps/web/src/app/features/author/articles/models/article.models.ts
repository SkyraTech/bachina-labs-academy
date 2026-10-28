export type ArticleStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';

export type TypographyPreset = 'MODERN_SANS' | 'EDITORIAL_SERIF' | 'TECHNICAL_MINIMAL';

export type ArticleBlockType =
  | 'HEADING'
  | 'RICH_TEXT'
  | 'IMAGE'
  | 'VIDEO'
  | 'CODE'
  | 'QUOTE'
  | 'CALLOUT'
  | 'TABLE'
  | 'DIVIDER'
  | 'LINK_CARD';

export interface HeadingBlockContent {
  text: string;
  level: 1 | 2 | 3 | 4;
}

export interface RichTextBlockContent {
  html: string;
}

export interface ImageBlockContent {
  caption?: string;
  altText?: string;
}

export interface VideoBlockContent {
  provider: 'YOUTUBE' | 'VIMEO' | 'CUSTOM';
  url: string;
  caption?: string;
}

export interface CodeBlockContent {
  code: string;
  language?: string;
  showLineNumbers?: boolean;
}

export interface QuoteBlockContent {
  quote: string;
  author?: string;
}

export interface CalloutBlockContent {
  variant: 'INFO' | 'WARNING' | 'TIP' | 'NOTE';
  title?: string;
  body: string;
}

export interface TableBlockContent {
  headers: string[];
  rows: string[][];
}

export type DividerBlockContent = Record<string, never>;

export interface LinkCardBlockContent {
  url: string;
  title: string;
  description?: string;
}

export type BlockContentPayload =
  | HeadingBlockContent
  | RichTextBlockContent
  | ImageBlockContent
  | VideoBlockContent
  | CodeBlockContent
  | QuoteBlockContent
  | CalloutBlockContent
  | TableBlockContent
  | DividerBlockContent
  | LinkCardBlockContent;

export interface ArticleBlock {
  id: string;
  articleId: string;
  type: ArticleBlockType;
  position: number;
  content: Record<string, unknown>;
  mediaAssetId: string | null;
  schemaVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface EditableArticle {
  id: string;
  authorId: string;
  title: string;
  draftSlug: string;
  publishedSlug: string | null;
  summary: string | null;
  status: ArticleStatus;
  typographyPreset: TypographyPreset;
  coverMediaId: string | null;
  draftRevision: number;
  publishedRevision: number;
  currentSnapshotId: string | null;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  blocks: ArticleBlock[];
}

export interface CreateArticleRequest {
  title: string;
  draftSlug: string;
  summary?: string | null;
  typographyPreset?: TypographyPreset;
  coverMediaId?: string | null;
}

export interface UpdateArticleMetadataRequest {
  expectedRevision: number;
  title?: string;
  draftSlug?: string;
  summary?: string | null;
  typographyPreset?: TypographyPreset;
  coverMediaId?: string | null;
}

export interface CreateBlockRequest {
  expectedRevision: number;
  type: ArticleBlockType;
  content: Record<string, unknown>;
  mediaAssetId?: string | null;
  schemaVersion?: number;
}

export interface UpdateBlockRequest {
  expectedRevision: number;
  content?: Record<string, unknown>;
  mediaAssetId?: string | null;
}

export interface ReorderBlocksRequest {
  expectedRevision: number;
  blockIds: string[];
}

export interface PublishArticleRequest {
  expectedRevision: number;
}

export interface ArticlePublicationResponse {
  articleId: string;
  status: ArticleStatus;
  draftRevision: number;
  publishedRevision: number;
  publishedSlug: string;
  currentSnapshotId: string;
  publishedAt: string;
}

export interface PaginatedAuthorArticlesResponse {
  items: EditableArticle[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export type SaveState = 'SAVED' | 'DIRTY' | 'SAVING' | 'ERROR' | 'CONFLICT';

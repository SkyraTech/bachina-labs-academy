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

export interface PublicMedia {
  readonly id: string;
  readonly mimeType: string;
  readonly width: number | null;
  readonly height: number | null;
  readonly altText: string | null;
  readonly url: string | null;
}

export interface PublicTaxonomyCategory {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
}

export interface PublicTaxonomyTag {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
}

export interface PublicDiscoveredTaxonomyItem {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly articleCount: number;
}

export interface PublicArticlesQueryOptions {
  readonly page?: number;
  readonly limit?: number;
  readonly category?: string;
  readonly tag?: string;
  readonly q?: string;
}

export interface PublicArticleItem {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly summary: string | null;
  readonly typographyPreset: TypographyPreset | string;
  readonly cover: PublicMedia | null;
  readonly revision: number;
  readonly publishedAt: string;
  readonly taxonomyCaptured: boolean;
  readonly category: PublicTaxonomyCategory | null;
  readonly tags: readonly PublicTaxonomyTag[];
}

export interface PublicArticleListResponse {
  readonly items: readonly PublicArticleItem[];
  readonly page: number;
  readonly limit: number;
  readonly total: number;
  readonly totalPages: number;
}

export interface HeadingBlockContent {
  readonly text: string;
  readonly level: number;
}

export interface RichTextBlockContent {
  readonly html: string;
}

export interface ImageBlockContent {
  readonly caption?: string;
  readonly altText?: string;
  readonly mediaAssetId?: string;
}

export type VideoProvider = 'YOUTUBE' | 'VIMEO' | 'CUSTOM';

export interface VideoBlockContent {
  readonly url: string;
  readonly provider: VideoProvider;
  readonly caption?: string;
}

export interface CodeBlockContent {
  readonly code: string;
  readonly language?: string;
  readonly showLineNumbers?: boolean;
}

export interface QuoteBlockContent {
  readonly quote: string;
  readonly author?: string;
}

export type CalloutVariant = 'INFO' | 'WARNING' | 'TIP' | 'NOTE';

export interface CalloutBlockContent {
  readonly variant: CalloutVariant;
  readonly title?: string;
  readonly body: string;
}

export interface TableBlockContent {
  readonly headers: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

export type DividerBlockContent = Record<string, unknown>;

export interface LinkCardBlockContent {
  readonly url: string;
  readonly title: string;
  readonly description?: string;
}

export interface PublicArticleBlock {
  readonly id: string;
  readonly type: ArticleBlockType;
  readonly position: number;
  readonly schemaVersion: number;
  readonly content: Record<string, unknown>;
  readonly media: PublicMedia | null;
}

export interface PublicArticleDetailResponse {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly summary: string | null;
  readonly typographyPreset: TypographyPreset | string;
  readonly cover: PublicMedia | null;
  readonly revision: number;
  readonly publishedAt: string;
  readonly blocks: readonly PublicArticleBlock[];
  readonly taxonomyCaptured: boolean;
  readonly category: PublicTaxonomyCategory | null;
  readonly tags: readonly PublicTaxonomyTag[];
}

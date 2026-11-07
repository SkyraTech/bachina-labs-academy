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

export interface PublicAuthorSummary {
  readonly id: string;
  readonly displayName: string;
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
  readonly authorId?: string;
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
  readonly author?: PublicAuthorSummary;
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
  readonly author?: PublicAuthorSummary;
}

/**
 * Generates a Unicode-safe, deterministic slug for heading anchors.
 * Preserves Unicode letters (\p{L}), combining marks (\p{M}), numbers (\p{N}),
 * and converts whitespace/punctuation to single hyphens, falling back to 'heading'.
 */
export function slugifyHeading(text: string): string {
  if (!text || typeof text !== 'string') return 'heading';
  const normalized = text.normalize('NFKC').trim().toLowerCase();
  const cleaned = normalized
    .replace(/[^\p{L}\p{M}\p{N}\s-]/gu, '')
    .replace(/[\s_-]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
  return cleaned || 'heading';
}

export interface HeadingAnchorMapping {
  readonly blockId: string;
  readonly anchorId: string;
  readonly text: string;
  readonly level: number;
}

/**
 * Computes deterministic, collision-resistant heading anchor mappings for all
 * supported heading levels (1, 2, 3, 4).
 */
export function computeHeadingAnchors(
  blocks: readonly PublicArticleBlock[] | undefined | null,
): {
  readonly items: readonly HeadingAnchorMapping[];
  readonly blockMap: ReadonlyMap<string, string>;
} {
  if (!blocks || blocks.length === 0) {
    return { items: [], blockMap: new Map() };
  }

  const items: HeadingAnchorMapping[] = [];
  const blockMap = new Map<string, string>();
  const slugCounts = new Map<string, number>();

  for (const b of blocks) {
    if (b.type === 'HEADING' && typeof b.content['text'] === 'string') {
      const text = b.content['text'].trim();
      if (!text) continue;
      const level =
        typeof b.content['level'] === 'number' && [1, 2, 3, 4].includes(b.content['level'])
          ? b.content['level']
          : 2;

      // H1, H2, H3, H4 are all captured in the TOC hierarchy
      if (level <= 4) {
        const rawSlug = slugifyHeading(text);
        const count = slugCounts.get(rawSlug) ?? 0;
        slugCounts.set(rawSlug, count + 1);
        const anchorId = count === 0 ? rawSlug : `${rawSlug}-${count}`;

        items.push({ blockId: b.id, anchorId, text, level });
        blockMap.set(b.id, anchorId);
      }
    }
  }

  return { items, blockMap };
}

import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import HardBreak from '@tiptap/extension-hard-break';
import Bold from '@tiptap/extension-bold';
import Italic from '@tiptap/extension-italic';
import Underline from '@tiptap/extension-underline';
import Strike from '@tiptap/extension-strike';
import Link from '@tiptap/extension-link';
import BulletList from '@tiptap/extension-bullet-list';
import OrderedList from '@tiptap/extension-ordered-list';
import ListItem from '@tiptap/extension-list-item';
import Blockquote from '@tiptap/extension-blockquote';
import Code from '@tiptap/extension-code';
import CodeBlock from '@tiptap/extension-code-block';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import History from '@tiptap/extension-history';
import type { Extensions } from '@tiptap/core';

/**
 * Custom extensions enforcing zero disallowed attributes
 * to strictly satisfy the backend fail-closed HTML sanitizer.
 */

export const CustomLink = Link.extend({
  renderHTML({ HTMLAttributes }) {
    const { href, title } = HTMLAttributes;
    const attrs: Record<string, string> = {};
    if (href) attrs['href'] = href;
    if (title) attrs['title'] = title;
    return ['a', attrs, 0];
  },
});

export const CustomParagraph = Paragraph.extend({
  renderHTML() {
    return ['p', 0];
  },
});

export const CustomBold = Bold.extend({
  renderHTML() {
    return ['strong', 0];
  },
});

export const CustomItalic = Italic.extend({
  renderHTML() {
    return ['em', 0];
  },
});

export const CustomUnderline = Underline.extend({
  renderHTML() {
    return ['u', 0];
  },
});

export const CustomStrike = Strike.extend({
  renderHTML() {
    return ['s', 0];
  },
});

export const CustomCode = Code.extend({
  renderHTML() {
    return ['code', 0];
  },
});

export const CustomSubscript = Subscript.extend({
  renderHTML() {
    return ['sub', 0];
  },
});

export const CustomSuperscript = Superscript.extend({
  renderHTML() {
    return ['sup', 0];
  },
});

export const CustomBulletList = BulletList.extend({
  renderHTML() {
    return ['ul', 0];
  },
});

export const CustomOrderedList = OrderedList.extend({
  renderHTML() {
    return ['ol', 0];
  },
});

export const CustomListItem = ListItem.extend({
  renderHTML() {
    return ['li', 0];
  },
});

export const CustomBlockquote = Blockquote.extend({
  renderHTML() {
    return ['blockquote', 0];
  },
});

export const CustomHardBreak = HardBreak.extend({
  renderHTML() {
    return ['br'];
  },
});

export const CustomCodeBlock = CodeBlock.extend({
  renderHTML() {
    return ['pre', ['code', 0]];
  },
});

/**
 * Strict URL validator matching backend requirements:
 * - Absolute HTTP or HTTPS
 * - Valid hostname
 * - No credentials in URL
 * - Valid URL structure
 */
export function validateLinkUrl(url: string): { isValid: boolean; error?: string } {
  if (!url || !url.trim()) {
    return { isValid: false, error: 'URL is required.' };
  }

  const trimmed = url.trim();

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { isValid: false, error: 'URL must use http: or https: protocol.' };
    }
    if (parsed.username || parsed.password) {
      return { isValid: false, error: 'URL must not contain embedded credentials.' };
    }
    if (!parsed.hostname || parsed.hostname.length === 0) {
      return { isValid: false, error: 'URL must contain a valid hostname.' };
    }
    return { isValid: true };
  } catch {
    return { isValid: false, error: 'Invalid URL format. Must be an absolute http:// or https:// URL.' };
  }
}

/**
 * Creates the complete curated list of Tiptap extensions.
 */
export function createEditorExtensions(): Extensions {
  return [
    Document,
    CustomParagraph,
    Text,
    CustomHardBreak,
    CustomBold,
    CustomItalic,
    CustomUnderline,
    CustomStrike,
    CustomLink.configure({
      openOnClick: false,
      HTMLAttributes: {},
      validate: href => validateLinkUrl(href).isValid,
    }),
    CustomBulletList,
    CustomOrderedList,
    CustomListItem,
    CustomBlockquote,
    CustomCode,
    CustomCodeBlock,
    CustomSubscript,
    CustomSuperscript,
    History,
  ];
}

const ALLOWED_TAGS = new Set([
  'p', 'br', 'strong', 'em', 'u', 's', 'a',
  'ul', 'ol', 'li', 'blockquote', 'code', 'pre', 'sub', 'sup'
]);

/**
 * Validates raw HTML string for HTML Source mode to prevent invalid input
 * from reaching the backend or corrupting visual mode.
 */
export function validateSourceHtml(rawHtml: string): { isValid: boolean; error?: string } {
  if (!rawHtml || !rawHtml.trim()) {
    return { isValid: false, error: 'Content cannot be empty.' };
  }

  if (rawHtml.length > 60000) {
    return { isValid: false, error: `Content length (${rawHtml.length}) exceeds maximum allowed 60,000 characters.` };
  }

  // Tokenize tags
  const tagRegex = /<(\/)?([a-z0-9]+)([^>]*)>/gi;
  let match: RegExpExecArray | null;

  while ((match = tagRegex.exec(rawHtml)) !== null) {
    const isClosing = Boolean(match[1]);
    const tag = match[2].toLowerCase();
    const rawAttrs = match[3].trim();

    if (!ALLOWED_TAGS.has(tag)) {
      return { isValid: false, error: `Unsupported HTML tag <${tag}>. Allowed: ${Array.from(ALLOWED_TAGS).join(', ')}.` };
    }

    if (isClosing) {
      if (rawAttrs.length > 0) {
        return { isValid: false, error: `Closing tag </${tag}> must not have attributes.` };
      }
      continue;
    }

    if (tag === 'a') {
      // Check attributes on opening <a>: only href and title allowed
      if (rawAttrs) {
        const attrRegex = /([a-z0-9_-]+)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/gi;
        let attrMatch: RegExpExecArray | null;
        let hasHref = false;

        while ((attrMatch = attrRegex.exec(rawAttrs)) !== null) {
          const attrName = attrMatch[1].toLowerCase();
          const attrValue = attrMatch[2] ?? attrMatch[3] ?? attrMatch[4] ?? '';

          if (attrName !== 'href' && attrName !== 'title') {
            return { isValid: false, error: `Prohibited attribute "${attrName}" on <a> tag. Only "href" and "title" are permitted.` };
          }

          if (attrName === 'href') {
            hasHref = true;
            const urlVal = validateLinkUrl(attrValue);
            if (!urlVal.isValid) {
              return { isValid: false, error: `Invalid link URL in <a href="${attrValue}">: ${urlVal.error}` };
            }
          }

          if (attrName === 'title' && attrValue.length > 255) {
            return { isValid: false, error: 'Link "title" attribute must not exceed 255 characters.' };
          }
        }

        if (!hasHref) {
          return { isValid: false, error: '<a> tag must include a valid "href" attribute.' };
        }
      } else {
        return { isValid: false, error: '<a> tag must include a valid "href" attribute.' };
      }
    } else {
      // All other 14 tags: ZERO attributes permitted
      if (rawAttrs.length > 0) {
        return { isValid: false, error: `Attributes are not permitted on <${tag}>. Found: "${rawAttrs}".` };
      }
    }
  }

  return { isValid: true };
}

import { BadRequestException } from '@nestjs/common';
import { ArticleBlockType } from '@prisma/client';

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

export type ArticleBlockContent =
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

const ALLOWED_HTML_ELEMENTS = new Set([
  'p',
  'br',
  'strong',
  'em',
  'u',
  's',
  'a',
  'ul',
  'ol',
  'li',
  'blockquote',
  'code',
  'pre',
  'sub',
  'sup',
]);

const VOID_HTML_ELEMENTS = new Set(['br']);

/**
 * Decodes numeric and standard named HTML entities to evaluate the true character representation.
 * Prevents protocol and attribute evasion via entity encoding (e.g. `jav&#x09;ascript:`).
 */
export function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&#x([0-9a-fA-F]+);?/g, (_, hex) => {
      try {
        return String.fromCodePoint(parseInt(hex, 16));
      } catch {
        return '';
      }
    })
    .replace(/&#([0-9]+);?/g, (_, dec) => {
      try {
        return String.fromCodePoint(parseInt(dec, 10));
      } catch {
        return '';
      }
    })
    .replace(/&quot;?/gi, '"')
    .replace(/&amp;?/gi, '&')
    .replace(/&apos;?/gi, "'")
    .replace(/&lt;?/gi, '<')
    .replace(/&gt;?/gi, '>');
}

/**
 * Escapes characters for safe output in HTML attribute values.
 */
function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Validates and canonicalizes HTML content using a strict character-by-character tokenizer and DOM state machine.
 * Enforces an explicit educational allowlist (`p`, `br`, `strong`, `em`, `u`, `s`, `a`, `ul`, `ol`, `li`, `blockquote`, `code`, `pre`, `sub`, `sup`).
 * Prohibits all attributes except `href` and `title` on `<a>` tags.
 * Validates link URLs to permit only absolute `http:` and `https:` schemes without embedded credentials.
 */
export function sanitizeAndValidateHtml(inputHtml: string): string {
  if (typeof inputHtml !== 'string' || inputHtml.trim().length === 0) {
    throw new BadRequestException('RICH_TEXT block requires a non-empty "html" string.');
  }

  if (inputHtml.length > 60000) {
    throw new BadRequestException('RICH_TEXT block "html" cannot exceed 60000 characters.');
  }

  // Reject control characters (except tab, LF, CR)
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(inputHtml)) {
    throw new BadRequestException('RICH_TEXT content contains invalid control characters.');
  }

  let i = 0;
  const len = inputHtml.length;
  const tagStack: string[] = [];
  let canonicalHtml = '';

  while (i < len) {
    const char = inputHtml[i];

    if (char === '<') {
      // 1. Comment check
      if (inputHtml.startsWith('<!--', i)) {
        const commentEnd = inputHtml.indexOf('-->', i + 4);
        if (commentEnd === -1) {
          throw new BadRequestException('Malformed or unclosed HTML comment.');
        }
        // Safely strip comment from canonical output
        i = commentEnd + 3;
        continue;
      }

      // 2. Closing tag: </tag>
      if (inputHtml[i + 1] === '/') {
        i += 2;
        let tagName = '';
        while (i < len && /[a-zA-Z0-9:-]/.test(inputHtml[i])) {
          tagName += inputHtml[i];
          i++;
        }
        tagName = tagName.toLowerCase();

        while (i < len && /\s/.test(inputHtml[i])) i++;
        if (inputHtml[i] !== '>') {
          throw new BadRequestException(`Malformed closing tag </${tagName}>.`);
        }
        i++; // skip '>'

        if (!ALLOWED_HTML_ELEMENTS.has(tagName)) {
          throw new BadRequestException(`Prohibited HTML closing tag: </${tagName}>.`);
        }
        if (VOID_HTML_ELEMENTS.has(tagName)) {
          throw new BadRequestException(`Void HTML element <${tagName}> cannot have a closing tag.`);
        }

        if (tagStack.length === 0 || tagStack[tagStack.length - 1] !== tagName) {
          throw new BadRequestException(
            `Misnested HTML closing tag: expected </${tagStack[tagStack.length - 1] ?? 'none'}>, found </${tagName}>.`,
          );
        }

        tagStack.pop();
        canonicalHtml += `</${tagName}>`;
        continue;
      }

      // 3. Opening tag: <tag ...>
      if (/[a-zA-Z]/.test(inputHtml[i + 1])) {
        i++;
        let tagName = '';
        while (i < len && /[a-zA-Z0-9:-]/.test(inputHtml[i])) {
          tagName += inputHtml[i];
          i++;
        }
        tagName = tagName.toLowerCase();

        if (!ALLOWED_HTML_ELEMENTS.has(tagName)) {
          throw new BadRequestException(`Prohibited HTML element: <${tagName}>.`);
        }

        const isVoid = VOID_HTML_ELEMENTS.has(tagName);
        let linkHref = '';
        let linkTitle = '';
        const seenAttrs = new Set<string>();

        // Parse attributes
        while (i < len && inputHtml[i] !== '>' && inputHtml[i] !== '/') {
          while (i < len && /\s/.test(inputHtml[i])) i++;
          if (inputHtml[i] === '>' || inputHtml[i] === '/' || i >= len) break;

          let attrName = '';
          while (i < len && /[a-zA-Z0-9_-]/.test(inputHtml[i])) {
            attrName += inputHtml[i];
            i++;
          }
          attrName = attrName.toLowerCase();

          if (seenAttrs.has(attrName)) {
            throw new BadRequestException(
              `Duplicate attribute "${attrName}" on <${tagName}> element.`,
            );
          }
          seenAttrs.add(attrName);

          if (attrName.startsWith('on')) {
            throw new BadRequestException(`Event handler attribute "${attrName}" is prohibited.`);
          }

          if (tagName !== 'a') {
            throw new BadRequestException(
              `Attributes are not permitted on <${tagName}>. Found: "${attrName}".`,
            );
          }

          if (attrName !== 'href' && attrName !== 'title') {
            throw new BadRequestException(
              `Prohibited attribute "${attrName}" on <a> element. Only "href" and "title" are allowed.`,
            );
          }

          while (i < len && /\s/.test(inputHtml[i])) i++;
          let attrValue = '';
          if (inputHtml[i] === '=') {
            i++;
            while (i < len && /\s/.test(inputHtml[i])) i++;

            if (inputHtml[i] === '"' || inputHtml[i] === "'") {
              const quote = inputHtml[i];
              i++;
              const valStart = i;
              while (i < len && inputHtml[i] !== quote) i++;
              if (i >= len) {
                throw new BadRequestException(`Unclosed attribute quote on "${attrName}".`);
              }
              attrValue = inputHtml.substring(valStart, i);
              i++; // skip quote
            } else {
              const valStart = i;
              while (i < len && !/\s|>|\//.test(inputHtml[i])) i++;
              attrValue = inputHtml.substring(valStart, i);
            }
          }

          const decodedValue = decodeHtmlEntities(attrValue).trim();

          if (attrName === 'href') {
            // Strict protocol and safety check on link href
            // eslint-disable-next-line no-control-regex
            const cleanHref = decodedValue.replace(/[\x00-\x1f\x7f\s]/g, '');
            let parsedHref: URL;
            try {
              parsedHref = new URL(cleanHref);
            } catch {
              throw new BadRequestException(
                'Invalid link URL: must be a valid absolute HTTP or HTTPS URL.',
              );
            }
            if (parsedHref.protocol !== 'http:' && parsedHref.protocol !== 'https:') {
              throw new BadRequestException(
                `Prohibited link protocol "${parsedHref.protocol}". Only http: and https: are allowed.`,
              );
            }
            if (parsedHref.username || parsedHref.password) {
              throw new BadRequestException('Links with embedded credentials are prohibited.');
            }
            linkHref = parsedHref.href;
          } else if (attrName === 'title') {
            if (decodedValue.length > 255) {
              throw new BadRequestException('Link "title" attribute cannot exceed 255 characters.');
            }
            linkTitle = decodedValue;
          }
        }

        // Check self-closing syntax
        let isSelfClosing = false;
        if (inputHtml[i] === '/') {
          isSelfClosing = true;
          i++;
        }
        while (i < len && /\s/.test(inputHtml[i])) i++;
        if (inputHtml[i] !== '>') {
          throw new BadRequestException(`Malformed HTML tag <${tagName}>.`);
        }
        i++; // skip '>'

        if (isSelfClosing && !isVoid) {
          throw new BadRequestException(
            `Non-void HTML element <${tagName}> must have an explicit closing tag.`,
          );
        }

        if (tagName === 'a') {
          if (!linkHref) {
            throw new BadRequestException('<a> link elements require a valid "href" attribute.');
          }
          let attrStr = ` href="${escapeHtmlAttr(linkHref)}"`;
          if (linkTitle) {
            attrStr += ` title="${escapeHtmlAttr(linkTitle)}"`;
          }
          canonicalHtml += `<a${attrStr}>`;
          tagStack.push('a');
        } else if (isVoid) {
          canonicalHtml += '<br>';
        } else {
          canonicalHtml += `<${tagName}>`;
          tagStack.push(tagName);
        }
        continue;
      }

      // If '<' is not starting a valid tag or comment, escape it
      canonicalHtml += '&lt;';
      i++;
    } else {
      canonicalHtml += char;
      i++;
    }
  }

  if (tagStack.length > 0) {
    throw new BadRequestException(
      `Unclosed HTML elements: <${tagStack[tagStack.length - 1]}> was not closed.`,
    );
  }

  return canonicalHtml;
}

/**
 * Validates absolute web URLs for VIDEO and LINK_CARD blocks.
 * Enforces http: and https: protocols, rejects embedded credentials, and rejects control characters.
 */
export function parseAndValidateUrl(
  urlString: unknown,
  fieldLabel: string,
): URL {
  if (typeof urlString !== 'string' || urlString.trim().length === 0) {
    throw new BadRequestException(`${fieldLabel} must be a non-empty string.`);
  }

  const trimmed = urlString.trim();
  if (trimmed.length > 2000) {
    throw new BadRequestException(`${fieldLabel} cannot exceed 2000 characters.`);
  }

  // Reject control characters and newlines
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f\s]/.test(trimmed)) {
    throw new BadRequestException(`${fieldLabel} contains invalid whitespace or control characters.`);
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new BadRequestException(`${fieldLabel} is not a valid absolute URL.`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new BadRequestException(
      `${fieldLabel} protocol must be http: or https: (received "${parsed.protocol}").`,
    );
  }

  if (parsed.username || parsed.password) {
    throw new BadRequestException(`${fieldLabel} cannot contain embedded credentials.`);
  }

  const hostname = parsed.hostname.toLowerCase();
  if (!hostname || !hostname.includes('.') || hostname.startsWith('.') || hostname.endsWith('.')) {
    throw new BadRequestException(`${fieldLabel} must contain a valid domain hostname.`);
  }

  return parsed;
}

/**
 * Convenience helper returning boolean for URL validity.
 */
export function isValidHttpUrl(urlString: string): boolean {
  try {
    parseAndValidateUrl(urlString, 'URL');
    return true;
  } catch {
    return false;
  }
}

/**
 * Validates and normalizes block content for all ten supported ArticleBlockType variants.
 * Applies an early application-level rejection threshold (<= 65,000 bytes compact JSON)
 * before deferring to PostgreSQL's authoritative 65,536-byte octet_length(content::text) CHECK constraint.
 */
export function validateBlockContent(
  type: ArticleBlockType,
  content: unknown,
): Record<string, any> {
  if (typeof content !== 'object' || content === null || Array.isArray(content)) {
    throw new BadRequestException('Block content must be a non-null JSON object.');
  }

  const jsonStr = JSON.stringify(content);
  const byteLength = Buffer.byteLength(jsonStr, 'utf8');
  if (byteLength > 65000) {
    throw new BadRequestException(
      `Block content exceeds maximum allowed size of 65536 bytes (application threshold: 65000 bytes; actual: ${byteLength} bytes).`,
    );
  }

  const payload = content as Record<string, any>;

  switch (type) {
    case ArticleBlockType.HEADING: {
      if (typeof payload.text !== 'string' || payload.text.trim().length === 0) {
        throw new BadRequestException('HEADING block requires a non-empty "text" string.');
      }
      if (payload.text.length > 500) {
        throw new BadRequestException('HEADING block "text" cannot exceed 500 characters.');
      }
      if (![1, 2, 3, 4].includes(payload.level)) {
        throw new BadRequestException('HEADING block "level" must be 1, 2, 3, or 4.');
      }
      return {
        text: payload.text.trim(),
        level: payload.level,
      };
    }

    case ArticleBlockType.RICH_TEXT: {
      const sanitized = sanitizeAndValidateHtml(payload.html);
      return {
        html: sanitized,
      };
    }

    case ArticleBlockType.IMAGE: {
      const sanitized: ImageBlockContent = {};
      if (payload.caption !== undefined && payload.caption !== null) {
        if (typeof payload.caption !== 'string' || payload.caption.length > 500) {
          throw new BadRequestException('IMAGE block "caption" must be a string up to 500 characters.');
        }
        sanitized.caption = payload.caption.trim();
      }
      if (payload.altText !== undefined && payload.altText !== null) {
        if (typeof payload.altText !== 'string' || payload.altText.length > 255) {
          throw new BadRequestException('IMAGE block "altText" must be a string up to 255 characters.');
        }
        sanitized.altText = payload.altText.trim();
      }
      return sanitized as Record<string, any>;
    }

    case ArticleBlockType.VIDEO: {
      if (!['YOUTUBE', 'VIMEO', 'CUSTOM'].includes(payload.provider)) {
        throw new BadRequestException('VIDEO block "provider" must be YOUTUBE, VIMEO, or CUSTOM.');
      }

      const parsed = parseAndValidateUrl(payload.url, 'VIDEO block "url"');
      const hostname = parsed.hostname.toLowerCase();

      if (payload.provider === 'YOUTUBE') {
        const allowedYouTubeHosts = new Set([
          'youtube.com',
          'www.youtube.com',
          'm.youtube.com',
          'youtu.be',
          'www.youtu.be',
        ]);
        if (!allowedYouTubeHosts.has(hostname)) {
          throw new BadRequestException(
            `Invalid host "${hostname}" for YOUTUBE provider. Must be an official YouTube domain.`,
          );
        }
      } else if (payload.provider === 'VIMEO') {
        const allowedVimeoHosts = new Set([
          'vimeo.com',
          'www.vimeo.com',
          'player.vimeo.com',
        ]);
        if (!allowedVimeoHosts.has(hostname)) {
          throw new BadRequestException(
            `Invalid host "${hostname}" for VIMEO provider. Must be an official Vimeo domain.`,
          );
        }
      } else if (payload.provider === 'CUSTOM') {
        if (parsed.protocol !== 'https:') {
          throw new BadRequestException('CUSTOM video provider requires https protocol.');
        }
      }

      const res: VideoBlockContent = {
        provider: payload.provider,
        url: parsed.href,
      };
      if (payload.caption !== undefined && payload.caption !== null) {
        if (typeof payload.caption !== 'string' || payload.caption.length > 500) {
          throw new BadRequestException('VIDEO block "caption" must be a string up to 500 characters.');
        }
        res.caption = payload.caption.trim();
      }
      return res as Record<string, any>;
    }

    case ArticleBlockType.CODE: {
      if (typeof payload.code !== 'string') {
        throw new BadRequestException('CODE block requires a "code" string.');
      }
      if (payload.code.length > 60000) {
        throw new BadRequestException('CODE block "code" cannot exceed 60000 characters.');
      }
      const res: CodeBlockContent = {
        code: payload.code,
      };
      if (payload.language !== undefined && payload.language !== null) {
        if (typeof payload.language !== 'string' || payload.language.length > 50) {
          throw new BadRequestException('CODE block "language" must be a string up to 50 characters.');
        }
        res.language = payload.language.trim();
      }
      if (payload.showLineNumbers !== undefined && payload.showLineNumbers !== null) {
        if (typeof payload.showLineNumbers !== 'boolean') {
          throw new BadRequestException('CODE block "showLineNumbers" must be a boolean.');
        }
        res.showLineNumbers = payload.showLineNumbers;
      }
      return res as Record<string, any>;
    }

    case ArticleBlockType.QUOTE: {
      if (typeof payload.quote !== 'string' || payload.quote.trim().length === 0) {
        throw new BadRequestException('QUOTE block requires a non-empty "quote" string.');
      }
      if (payload.quote.length > 5000) {
        throw new BadRequestException('QUOTE block "quote" cannot exceed 5000 characters.');
      }
      const res: QuoteBlockContent = {
        quote: payload.quote.trim(),
      };
      if (payload.author !== undefined && payload.author !== null) {
        if (typeof payload.author !== 'string' || payload.author.length > 255) {
          throw new BadRequestException('QUOTE block "author" must be a string up to 255 characters.');
        }
        res.author = payload.author.trim();
      }
      return res as Record<string, any>;
    }

    case ArticleBlockType.CALLOUT: {
      if (!['INFO', 'WARNING', 'TIP', 'NOTE'].includes(payload.variant)) {
        throw new BadRequestException('CALLOUT block "variant" must be INFO, WARNING, TIP, or NOTE.');
      }
      if (typeof payload.body !== 'string' || payload.body.trim().length === 0) {
        throw new BadRequestException('CALLOUT block requires a non-empty "body" string.');
      }
      if (payload.body.length > 5000) {
        throw new BadRequestException('CALLOUT block "body" cannot exceed 5000 characters.');
      }
      const res: CalloutBlockContent = {
        variant: payload.variant,
        body: payload.body.trim(),
      };
      if (payload.title !== undefined && payload.title !== null) {
        if (typeof payload.title !== 'string' || payload.title.length > 255) {
          throw new BadRequestException('CALLOUT block "title" must be a string up to 255 characters.');
        }
        res.title = payload.title.trim();
      }
      return res as Record<string, any>;
    }

    case ArticleBlockType.TABLE: {
      if (!Array.isArray(payload.headers) || payload.headers.length === 0 || payload.headers.length > 20) {
        throw new BadRequestException('TABLE block "headers" must be a non-empty array with at most 20 columns.');
      }
      for (const h of payload.headers) {
        if (typeof h !== 'string' || h.length > 255) {
          throw new BadRequestException('TABLE block header entries must be strings up to 255 characters.');
        }
      }
      if (!Array.isArray(payload.rows) || payload.rows.length > 100) {
        throw new BadRequestException('TABLE block "rows" must be an array with at most 100 rows.');
      }
      for (const row of payload.rows) {
        if (!Array.isArray(row) || row.length !== payload.headers.length) {
          throw new BadRequestException('Each TABLE row must match the number of headers.');
        }
        for (const cell of row) {
          if (typeof cell !== 'string' || cell.length > 1000) {
            throw new BadRequestException('TABLE cell entries must be strings up to 1000 characters.');
          }
        }
      }
      return {
        headers: payload.headers,
        rows: payload.rows,
      };
    }

    case ArticleBlockType.DIVIDER: {
      return {};
    }

    case ArticleBlockType.LINK_CARD: {
      const parsed = parseAndValidateUrl(payload.url, 'LINK_CARD block "url"');
      if (typeof payload.title !== 'string' || payload.title.trim().length === 0 || payload.title.length > 255) {
        throw new BadRequestException('LINK_CARD block requires a non-empty "title" string up to 255 characters.');
      }
      const res: LinkCardBlockContent = {
        url: parsed.href,
        title: payload.title.trim(),
      };
      if (payload.description !== undefined && payload.description !== null) {
        if (typeof payload.description !== 'string' || payload.description.length > 1000) {
          throw new BadRequestException('LINK_CARD block "description" must be a string up to 1000 characters.');
        }
        res.description = payload.description.trim();
      }
      return res as Record<string, any>;
    }

    default:
      throw new BadRequestException(`Unsupported block type: ${String(type)}`);
  }
}

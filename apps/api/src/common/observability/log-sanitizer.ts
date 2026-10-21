/**
 * LogSanitizer — centralized deterministic sensitive-data sanitization engine.
 *
 * Implements strict redaction of credentials, tokens, cookies, authorization headers,
 * password hashes, circular structures, and query parameters across all log events.
 * Compliant with OWASP Logging Guide and Elastic Common Schema (ECS 8.11).
 */

const SENSITIVE_KEY_REGEX =
  /^(password|passwordhash|newpassword|currentpassword|repeatpassword|password_hash|authorization|cookie|set-cookie|access_token|accesstoken|refresh_token|refreshtoken|academy_access|academy_refresh|academyaccess|academyrefresh|token|verificationtoken|verification_token|tokensecret|secret|apikey|api_key|resend_api_key|privatekey|private_key|credential|credentials)$/i;

const SENSITIVE_KEY_SUBSTRING_REGEX =
  /(password|passwd|secret|[a-z0-9_-]token$|[a-z0-9_-]cookie$|api[_-]?key|private[_-]?key|access[_-]?key|academy[_-]?access|academy[_-]?refresh)/i;

const BEARER_REGEX = /Bearer\s+[A-Za-z0-9._~+/-]+=*/gi;
const JWT_REGEX = /eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g;
const ARGON2_REGEX =
  /\$argon2(id|i|d)\$v=\d+\$m=\d+,t=\d+,p=\d+\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+/g;

const COOKIE_PAIR_REGEX =
  /(academy_access|academy_refresh|access_token|refresh_token|session|jwt)=[^;,\s]+/gi;
const KEY_VALUE_PAIR_REGEX =
  /(password|passwd|secret|token|credential|cookie|key)\s*[:=]\s*['"]?([^\s,'"&;]+)['"]?/gi;

const MAX_DEPTH = 6;
const REDACTED = '[REDACTED]';
const REDACTED_JWT = '[REDACTED_JWT]';
const REDACTED_HASH = '[REDACTED_HASH]';
const DEPTH_EXCEEDED = '[DEPTH_EXCEEDED]';
const CIRCULAR_REF = '[CIRCULAR]';

export class LogSanitizer {
  /**
   * Recursively sanitizes any arbitrary value, object, array or primitive.
   * Circular references and deep nestings are safely bounded.
   */
  static sanitize<T>(val: T, seen = new WeakSet<object>(), depth = 0): unknown {
    if (val === null || val === undefined) {
      return val;
    }

    if (typeof val === 'string') {
      return this.sanitizeString(val);
    }

    if (typeof val === 'number' || typeof val === 'boolean') {
      return val;
    }

    if (typeof val === 'bigint') {
      return val.toString();
    }

    if (typeof val === 'function' || typeof val === 'symbol') {
      return String(val);
    }

    if (val instanceof Date) {
      return val.toISOString();
    }

    if (val instanceof Error) {
      return this.normalizeError(val);
    }

    if (depth >= MAX_DEPTH) {
      return DEPTH_EXCEEDED;
    }

    if (typeof val === 'object') {
      if (seen.has(val)) {
        return CIRCULAR_REF;
      }
      seen.add(val);

      if (Array.isArray(val)) {
        return val.map((item) => this.sanitize(item, seen, depth + 1));
      }

      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(val)) {
        if (SENSITIVE_KEY_REGEX.test(key) || SENSITIVE_KEY_SUBSTRING_REGEX.test(key)) {
          result[key] = REDACTED;
        } else {
          result[key] = this.sanitize(value, seen, depth + 1);
        }
      }
      return result;
    }

    return String(val);
  }

  /**
   * Sanitizes string values by redacting bearer tokens, raw JWTs, password hashes,
   * cookie key-value pairs, and credentials.
   */
  static sanitizeString(str: string): string {
    if (!str || typeof str !== 'string') {
      return str;
    }

    let sanitized = str;

    if (BEARER_REGEX.test(sanitized)) {
      sanitized = sanitized.replace(BEARER_REGEX, 'Bearer [REDACTED]');
    }

    if (JWT_REGEX.test(sanitized)) {
      sanitized = sanitized.replace(JWT_REGEX, REDACTED_JWT);
    }

    if (ARGON2_REGEX.test(sanitized)) {
      sanitized = sanitized.replace(ARGON2_REGEX, REDACTED_HASH);
    }

    if (COOKIE_PAIR_REGEX.test(sanitized)) {
      sanitized = sanitized.replace(COOKIE_PAIR_REGEX, '$1=[REDACTED]');
    }

    if (KEY_VALUE_PAIR_REGEX.test(sanitized)) {
      sanitized = sanitized.replace(KEY_VALUE_PAIR_REGEX, '$1=[REDACTED]');
    }

    return sanitized;
  }

  /**
   * Sanitizes URL paths by stripping sensitive query parameters.
   * For operational logging, query strings are omitted to prevent token leakages.
   */
  static sanitizeUrl(urlStr: string): string {
    if (!urlStr || typeof urlStr !== 'string') {
      return '';
    }

    try {
      if (urlStr.startsWith('/') || urlStr.startsWith('\\')) {
        const queryIndex = urlStr.indexOf('?');
        return queryIndex !== -1 ? urlStr.slice(0, queryIndex) : urlStr;
      }

      const parsed = new URL(urlStr);
      return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
    } catch {
      // In case of malformed URL, strip anything after '?'
      const queryIndex = urlStr.indexOf('?');
      return queryIndex !== -1 ? urlStr.slice(0, queryIndex) : urlStr;
    }
  }

  /**
   * Sanitizes Referer headers by extracting only the origin (protocol + host),
   * ensuring paths, IDs, or query strings in Referer headers are never logged.
   */
  static sanitizeReferer(referer: string | undefined): string {
    if (!referer || typeof referer !== 'string') {
      return '';
    }

    try {
      const parsed = new URL(referer);
      return parsed.origin;
    } catch {
      return '[MALFORMED_REFERER]';
    }
  }

  /**
   * Normalizes an exception into standard ECS error structure with sanitized messages.
   * In production mode, unhandled 5xx/internal errors receive a safe generic message
   * and stack traces are suppressed to prevent credential or internal leakages.
   */
  static normalizeError(
    error: unknown,
    isProduction = false,
  ): {
    type: string;
    message: string;
    stack_trace?: string;
  } {
    if (error instanceof Error) {
      const sanitizedMessage = isProduction
        ? 'An internal server error occurred.'
        : this.sanitizeString(error.message);
      const sanitizedStack =
        !isProduction && error.stack ? this.sanitizeString(error.stack) : undefined;
      return {
        type: error.name || 'Error',
        message: sanitizedMessage,
        ...(sanitizedStack ? { stack_trace: sanitizedStack } : {}),
      };
    }

    if (typeof error === 'object' && error !== null) {
      const candidate = error as { name?: unknown; message?: unknown; stack?: unknown };
      const type = typeof candidate.name === 'string' ? candidate.name : 'UnknownError';
      const rawMessage =
        typeof candidate.message === 'string'
          ? candidate.message
          : 'An unexpected error occurred.';
      const message = isProduction
        ? 'An internal server error occurred.'
        : this.sanitizeString(rawMessage);
      const stack =
        !isProduction && typeof candidate.stack === 'string'
          ? this.sanitizeString(candidate.stack)
          : undefined;
      return {
        type,
        message,
        ...(stack ? { stack_trace: stack } : {}),
      };
    }

    return {
      type: 'UnknownError',
      message: isProduction
        ? 'An internal server error occurred.'
        : this.sanitizeString(String(error)),
    };
  }
}

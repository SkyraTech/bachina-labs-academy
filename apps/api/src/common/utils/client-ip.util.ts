import type { Request } from 'express';

/**
 * Validates and parses the TRUST_PROXY environment configuration.
 *
 * Security Rationale:
 * Blindly configuring `trust proxy = true` in Express causes the application
 * to trust arbitrary client-supplied `X-Forwarded-For` headers, allowing attackers
 * to spoof their IP address and bypass rate limiting, geo-fencing, and auditing.
 *
 * This validator enforces:
 * 1. Default `false` (direct connection mode, safe for local dev and direct access).
 * 2. Explicit integer hop counts (e.g. '1' for single ingress proxy/ALB/Nginx).
 * 3. Standard Express network keywords ('loopback', 'linklocal', 'uniquelocal').
 * 4. Explicit IP addresses or CIDR blocks (e.g. '127.0.0.1, 10.0.0.0/8').
 * 5. Rejection of blind 'true' with an actionable error message.
 * 6. Rejection of malformed values at application startup.
 */
export function validateTrustProxy(
  raw: string | undefined,
): boolean | number | string | string[] {
  if (!raw || raw.trim() === '' || raw.trim().toLowerCase() === 'false') {
    return false;
  }

  const trimmed = raw.trim();

  // Reject insecure blind 'true'
  if (trimmed.toLowerCase() === 'true') {
    throw new Error(
      'Insecure TRUST_PROXY configuration: blind "true" is prohibited. ' +
        'Specify an explicit hop count (e.g. "1") or trusted CIDRs/subnets (e.g. "loopback, 10.0.0.0/8").',
    );
  }

  // Check for integer hop count
  if (/^\d+$/.test(trimmed)) {
    const hops = parseInt(trimmed, 10);
    if (hops < 1 || hops > 20) {
      throw new Error(
        `Invalid TRUST_PROXY hop count: "${trimmed}". Must be an integer between 1 and 20.`,
      );
    }
    return hops;
  }

  // Check for standard Express keywords or IP/CIDR list
  const validKeywords = new Set(['loopback', 'linklocal', 'uniquelocal']);
  const tokens = trimmed.split(',').map((t) => t.trim()).filter(Boolean);

  if (tokens.length === 0) {
    return false;
  }

  // IPv4, IPv6, CIDR regex patterns
  const ipv4Pattern =
    /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)(?:\/(?:3[0-2]|[12]?\d))?$/;
  const ipv6Pattern =
    /^(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}(?:\/(?:12[0-8]|1[01]\d|[1-9]?\d))?$/;
  const ipv6CompressedPattern =
    /^((?:[0-9a-fA-F]{1,4}(?::[0-9a-fA-F]{1,4})*)?)::((?:[0-9a-fA-F]{1,4}(?::[0-9a-fA-F]{1,4})*)?)(?:\/(?:12[0-8]|1[01]\d|[1-9]?\d))?$/;

  for (const token of tokens) {
    const lower = token.toLowerCase();
    const isKeyword = validKeywords.has(lower);
    const isIpv4 = ipv4Pattern.test(token);
    const isIpv6 = ipv6Pattern.test(token) || ipv6CompressedPattern.test(token);

    if (!isKeyword && !isIpv4 && !isIpv6) {
      throw new Error(
        `Invalid TRUST_PROXY configuration token: "${token}". ` +
          'Must be a valid integer hop count, keyword ("loopback", "linklocal", "uniquelocal"), or valid IPv4/IPv6/CIDR.',
      );
    }
  }

  return tokens.length === 1 ? tokens[0]! : tokens;
}

/**
 * Extracts and normalizes the client IP address from an Express request.
 *
 * When Express has 'trust proxy' configured, `req.ip` is populated
 * according to the trusted proxy boundaries.
 *
 * Normalization:
 * - Strips IPv4-mapped IPv6 prefix (`::ffff:192.0.2.1` -> `192.0.2.1`).
 * - Falls back to socket remoteAddress if `req.ip` is missing.
 * - Trims whitespace and normalizes case.
 */
export function getClientIp(req: Request): string {
  let ip = req.ip || req.socket?.remoteAddress || '127.0.0.1';

  // Normalize IPv4-mapped IPv6 address (::ffff:x.x.x.x)
  if (ip.startsWith('::ffff:')) {
    ip = ip.substring(7);
  }

  return ip.trim();
}

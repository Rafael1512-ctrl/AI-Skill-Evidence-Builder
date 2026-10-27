import { isIP } from 'node:net';

import { AppError } from '../../utils/errors.js';

/**
 * SSRF guards for outbound fetches.
 *
 * URLs here come from candidate material, so they are attacker-chosen. Every check below is
 * pure and synchronous: the guarded provider resolves a hostname to addresses and then runs
 * `isBlockedAddress` on each one, so a DNS name that resolves into a private range is refused
 * just like a literal IP would be.
 */

/** Hostnames that must never be fetched, even if they resolve publicly. */
const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'metadata',
  'metadata.google.internal',
  'instance-data',
]);

const BLOCKED_HOST_SUFFIXES = ['.localhost', '.internal', '.local', '.home.arpa'];

/** Content types worth sending to a model; everything else is refused as unreadable. */
const ALLOWED_CONTENT_TYPES = [
  'text/html',
  'text/plain',
  'application/xhtml+xml',
  'application/json',
  'text/json',
];

export const MAX_REDIRECTS = 3;

/** True for every address range that must never be reachable from user-supplied URLs. */
export function isBlockedAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return isBlockedIpv4(address);
  if (version === 6) return isBlockedIpv6(address);
  // Not an IP at all: treat it as untrustworthy rather than guessing.
  return true;
}

function isBlockedIpv4(address: string): boolean {
  const parts = address.split('.').map((part) => Number(part));
  const [a = 0, b = 0] = parts;

  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return true;
  }

  if (a === 0 || a === 10 || a === 127) return true; // this-network, private, loopback
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 0) return true; // IETF protocol assignments
  if (a === 192 && b === 168) return true; // private
  if (a === 192 && b === 88) return true; // 6to4 relay anycast
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a >= 224) return true; // multicast and reserved
  return false;
}

function isBlockedIpv6(address: string): boolean {
  const normalised = address.toLowerCase().split('%')[0] ?? address.toLowerCase();

  if (normalised === '::' || normalised === '::1') return true;
  if (normalised.startsWith('fe80')) return true; // link-local
  if (normalised.startsWith('fc') || normalised.startsWith('fd')) return true; // unique local
  if (normalised.startsWith('ff')) return true; // multicast

  // IPv4-mapped (::ffff:a.b.c.d) must be judged by the IPv4 rules.
  const mapped = normalised.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped?.[1]) return isBlockedIpv4(mapped[1]);

  return false;
}

/** Only http(s), and never a hostname on the internal blocklist. */
export function assertUrlAllowed(input: string): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw AppError.validation({ url: input }, 'URL tidak valid.');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw AppError.validation({ protocol: url.protocol }, 'Hanya URL http/https yang didukung.');
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  if (hostname.length === 0) {
    throw AppError.validation({ url: input }, 'URL tidak memiliki host.');
  }
  if (
    BLOCKED_HOSTNAMES.has(hostname) ||
    BLOCKED_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))
  ) {
    throw AppError.validation({ hostname }, 'Host internal tidak boleh diambil.');
  }
  if (isIP(hostname) !== 0 && isBlockedAddress(hostname)) {
    throw AppError.validation({ hostname }, 'Alamat jaringan internal tidak boleh diambil.');
  }

  return url;
}

/** Adds `www.`/case-insensitive matching on top of the URL check. */
export function classifyLinkHost(
  hostname: string,
): 'GITHUB' | 'PORTFOLIO' | 'LINKEDIN_SELF_REPORTED' {
  const host = hostname.toLowerCase().replace(/^www\./, '');
  if (host === 'github.com' || host.endsWith('.github.io')) return 'GITHUB';
  if (host === 'linkedin.com' || host.endsWith('.linkedin.com')) return 'LINKEDIN_SELF_REPORTED';
  return 'PORTFOLIO';
}

export function assertContentTypeAllowed(contentType: string | null): void {
  const value = (contentType ?? '').toLowerCase().split(';')[0]?.trim() ?? '';
  if (value.length === 0) return; // some servers omit it; the size cap still protects us
  if (!ALLOWED_CONTENT_TYPES.includes(value)) {
    throw AppError.unsupportedFile('Halaman ini bukan teks yang bisa dibaca.', {
      contentType: value,
    });
  }
}

/**
 * Crude but dependency-free text extraction.
 *
 * The page is data: scripts, styles and tags are removed before anything reaches a prompt,
 * which also means a page cannot smuggle instructions through markup attributes.
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

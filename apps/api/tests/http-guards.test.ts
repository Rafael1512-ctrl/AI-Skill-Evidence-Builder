import { describe, expect, it } from 'vitest';

import { GuardedHttpProvider } from '../src/providers/http/index.js';
import {
  assertContentTypeAllowed,
  assertUrlAllowed,
  classifyLinkHost,
  htmlToText,
  isBlockedAddress,
} from '../src/providers/http/guards.js';

/**
 * SSRF guards. Pure and offline - no socket is opened here.
 *
 * These are the checks that stand between a candidate-supplied link and the network, so the
 * cases below are the security boundary: cloud metadata, loopback, private ranges, IPv4-mapped
 * forms and non-http schemes.
 */

describe('blocked addresses', () => {
  it('refuses loopback, private, link-local, CGNAT, metadata and reserved IPv4', () => {
    for (const address of [
      '0.0.0.0',
      '10.1.2.3',
      '127.0.0.1',
      '100.64.0.1',
      '169.254.169.254', // cloud metadata
      '172.16.0.1',
      '192.168.1.1',
      '198.18.0.1',
      '224.0.0.1',
      '255.255.255.255',
    ]) {
      expect(isBlockedAddress(address), address).toBe(true);
    }
  });

  it('allows ordinary public IPv4 addresses', () => {
    for (const address of ['1.1.1.1', '8.8.8.8', '140.82.121.4', '203.0.113.10']) {
      expect(isBlockedAddress(address), address).toBe(false);
    }
  });

  it('refuses IPv6 loopback, unique-local, link-local and multicast', () => {
    for (const address of ['::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'ff02::1']) {
      expect(isBlockedAddress(address), address).toBe(true);
    }
  });

  it('judges an IPv4-mapped address by the IPv4 rules', () => {
    expect(isBlockedAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isBlockedAddress('::ffff:10.0.0.1')).toBe(true);
    expect(isBlockedAddress('::ffff:1.1.1.1')).toBe(false);
  });

  it('treats anything that is not an IP as untrustworthy', () => {
    expect(isBlockedAddress('not-an-ip')).toBe(true);
  });
});

describe('URL allow rules', () => {
  it('accepts a public http(s) URL', () => {
    expect(assertUrlAllowed('https://github.com/andi').hostname).toBe('github.com');
    expect(assertUrlAllowed('http://example.com/cv').protocol).toBe('http:');
  });

  it('refuses other schemes and non-URLs', () => {
    for (const input of ['file:///etc/passwd', 'javascript:alert(1)', 'not a url']) {
      expect(() => assertUrlAllowed(input), input).toThrow();
    }
  });

  it('refuses internal hostnames and internal literals', () => {
    for (const input of [
      'http://localhost/admin',
      'http://LOCALHOST/admin',
      'http://metadata.google.internal/',
      'http://169.254.169.254/latest/meta-data/',
      'http://10.0.0.5/',
      'http://127.0.0.1:4000/health',
      'http://db.internal/',
      'http://printer.local/',
    ]) {
      expect(() => assertUrlAllowed(input), input).toThrow();
    }
  });
});

describe('link classification', () => {
  it('separates GitHub, self-reported LinkedIn and other portfolios', () => {
    expect(classifyLinkHost('github.com')).toBe('GITHUB');
    expect(classifyLinkHost('www.github.com')).toBe('GITHUB');
    expect(classifyLinkHost('andi.github.io')).toBe('GITHUB');
    expect(classifyLinkHost('linkedin.com')).toBe('LINKEDIN_SELF_REPORTED');
    expect(classifyLinkHost('www.linkedin.com')).toBe('LINKEDIN_SELF_REPORTED');
    expect(classifyLinkHost('andi.dev')).toBe('PORTFOLIO');
  });
});

describe('content type and text extraction', () => {
  it('only accepts readable text types', () => {
    expect(() => assertContentTypeAllowed('text/html; charset=utf-8')).not.toThrow();
    expect(() => assertContentTypeAllowed('application/json')).not.toThrow();
    expect(() => assertContentTypeAllowed(null)).not.toThrow();
    expect(() => assertContentTypeAllowed('application/pdf')).toThrow();
    expect(() => assertContentTypeAllowed('image/png')).toThrow();
  });

  it('strips markup, scripts and entities before anything reaches a prompt', () => {
    const text = htmlToText(
      '<html><head><style>body{color:red}</style><script>alert(1)</script></head><body><h1>Andi</h1><p>Proyek &amp; keahlian &lt;web&gt;</p><!-- komentar --></body></html>',
    );

    expect(text).toContain('Andi');
    expect(text).toContain('Proyek & keahlian <web>');
    expect(text).not.toContain('alert');
    expect(text).not.toContain('color:red');
    expect(text).not.toContain('komentar');
  });
});

describe('guarded provider DNS check', () => {
  it('refuses a public hostname that resolves to a private address', async () => {
    const provider = new GuardedHttpProvider({
      timeoutMs: 500,
      maxBytes: 1024,
      // The whole point of resolving first: a name that points inward is refused.
      resolveHost: async () => ['10.1.2.3'],
    });

    await expect(provider.get({ url: 'https://looks-public.example/' })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  it('refuses a host that does not resolve', async () => {
    const provider = new GuardedHttpProvider({
      timeoutMs: 500,
      maxBytes: 1024,
      resolveHost: async () => [],
    });

    await expect(provider.get({ url: 'https://nowhere.example/' })).rejects.toMatchObject({
      code: 'UPSTREAM_UNAVAILABLE',
    });
  });
});

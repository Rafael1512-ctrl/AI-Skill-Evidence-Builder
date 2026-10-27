import { describe, expect, it } from 'vitest';

import {
  CV_TEMPLATE_KEYS,
  cvEnhancementDocumentSchema,
  type CvEnhancementDocument,
  type CvTemplateKey,
} from '@aseb/shared';

import { MockPdfRenderer } from '../src/providers/pdf/mock.provider.js';
import {
  cvDocumentToPlainText,
  cvExportFileName,
  renderCvHtml,
} from '../src/templates/cv/index.js';

/**
 * Template contract tests.
 *
 * The enhanced document is derived from an untrusted CV, so these pin the two things that
 * must never regress: every template renders all three keys, and no value can escape its
 * HTML context or reach the network when Chromium prints it.
 */
function documentOf(overrides: Partial<CvEnhancementDocument> = {}): CvEnhancementDocument {
  return cvEnhancementDocumentSchema.parse({
    fullName: 'Budi Santoso',
    headline: 'Backend Engineer',
    contact: {
      email: 'budi@example.com',
      phone: null,
      location: 'Jakarta',
      linkedinUrl: 'https://linkedin.com/in/budi',
      githubUrl: null,
      portfolioUrl: null,
    },
    professionalSummary: 'Backend engineer dengan pengalaman lima tahun.',
    experience: [
      {
        jobTitle: 'Software Engineer',
        company: 'PT Contoh',
        location: 'Jakarta',
        startDate: '2021',
        endDate: null,
        current: true,
        summary: null,
        bullets: [
          {
            text: 'Membangun layanan web untuk layanan publik.',
            sourceQuote: 'Pengalaman kerja lima tahun membangun aplikasi web',
          },
        ],
      },
    ],
    projects: [
      {
        name: 'Sistem Arsip',
        role: 'Tech Lead',
        description: null,
        technologies: ['TypeScript', 'PostgreSQL'],
        bullets: [{ text: 'Memimpin migrasi basis data.', sourceQuote: null }],
        url: null,
        sourceQuote: null,
      },
    ],
    skills: { technical: ['TypeScript'], tools: ['Docker'], soft: ['Kolaborasi'] },
    education: [
      {
        institution: 'Universitas Indonesia',
        degree: 'S1',
        field: 'Ilmu Komputer',
        startDate: null,
        endDate: '2019',
        grade: null,
        details: [],
      },
    ],
    certifications: [{ name: 'AWS Practitioner', issuer: 'AWS', issuedAt: null, credentialId: null }],
    languages: ['Indonesia', 'Inggris'],
    additionalSections: [{ title: 'Organisasi', items: ['Anggota komunitas backend.'] }],
    changeLog: [],
    missingInformation: [],
    atsReadinessScore: 80,
    ...overrides,
  });
}

describe('CV export templates', () => {
  it('renders every known template key', () => {
    for (const templateKey of CV_TEMPLATE_KEYS) {
      const html = renderCvHtml({ document: documentOf(), templateKey });

      expect(html.startsWith('<!doctype html>')).toBe(true);
      expect(html).toContain('Budi Santoso');
      expect(html).toContain('Ringkasan Profesional');
      expect(html).toContain('Pengalaman Kerja');
    }
  });

  it('carries a strict CSP and no script or remote-resource surface', () => {
    for (const templateKey of CV_TEMPLATE_KEYS) {
      const html = renderCvHtml({ document: documentOf(), templateKey });

      expect(html).toContain("default-src 'none'");
      expect(html).toContain("script-src 'none'");
      expect(html).not.toContain('<script');
      expect(html).not.toMatch(/\ssrc=/);
      expect(html).not.toMatch(/<a\s/i);
    }
  });

  it('escapes untrusted CV text instead of embedding it as markup', () => {
    const document = documentOf({
      fullName: '<script>alert("xss")</script>',
      professionalSummary: 'A & B <b>bold</b> "quoted"',
    });

    for (const templateKey of CV_TEMPLATE_KEYS) {
      const html = renderCvHtml({ document, templateKey });

      expect(html).not.toContain('<script>alert');
      expect(html).toContain('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
      expect(html).toContain('A &amp; B &lt;b&gt;bold&lt;/b&gt; &quot;quoted&quot;');
    }
  });

  it('omits empty sections rather than printing empty headings', () => {
    const sparse = documentOf({
      experience: [],
      projects: [],
      education: [],
      certifications: [],
      languages: [],
      additionalSections: [],
      skills: { technical: [], tools: [], soft: [] },
    });

    const html = renderCvHtml({ document: sparse, templateKey: 'ATS_MINIMAL' });

    expect(html).toContain('Ringkasan Profesional');
    expect(html).not.toContain('Pengalaman Kerja');
    expect(html).not.toContain('Sertifikasi');
    expect(html).not.toContain('Bahasa');
  });

  it('produces a safe download name per template', () => {
    for (const templateKey of CV_TEMPLATE_KEYS) {
      const fileName = cvExportFileName({ document: documentOf(), templateKey });

      expect(fileName).toBe(`Budi_Santoso-${templateKey.toLowerCase()}.pdf`);
      expect(fileName).not.toMatch(/[\\/]/);
    }
  });

  it('renders a searchable plain-text rendition for the stored record', () => {
    const text = cvDocumentToPlainText(documentOf());

    expect(text).toContain('Budi Santoso');
    expect(text).toContain('RINGKASAN PROFESIONAL');
    expect(text).toContain('PENGALAMAN KERJA');
    expect(text).toContain('Membangun layanan web untuk layanan publik.');
    expect(text).not.toContain('<');
  });

  it('mock renderer returns a deterministic PDF whose text fingerprints the HTML', async () => {
    const renderer = new MockPdfRenderer();
    const html = renderCvHtml({ document: documentOf(), templateKey: 'PROFESSIONAL' });

    const first = await renderer.render({ html, title: 'CV' });
    const second = await renderer.render({ html, title: 'CV' });
    const other = await renderer.render({
      html: renderCvHtml({ document: documentOf(), templateKey: 'MODERN' }),
      title: 'CV',
    });

    expect(first.buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(first.pageCount).toBe(1);
    expect(first.buffer.equals(second.buffer)).toBe(true);
    // Different templates produce different HTML, so the fingerprint must differ.
    expect(first.buffer.equals(other.buffer)).toBe(false);
    expect(first.buffer.toString('latin1')).toContain(`htmlBytes=${Buffer.byteLength(html, 'utf8')}`);
  });
});

describe('template key coverage', () => {
  it('has exactly three templates, each with a renderer', () => {
    const keys: readonly CvTemplateKey[] = CV_TEMPLATE_KEYS;
    expect(keys).toHaveLength(3);
    for (const key of keys) {
      expect(() => renderCvHtml({ document: documentOf(), templateKey: key })).not.toThrow();
    }
  });
});

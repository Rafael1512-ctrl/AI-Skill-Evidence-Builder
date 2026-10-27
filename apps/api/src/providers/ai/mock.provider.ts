import {
  cvAuditAnalysisSchema,
  cvEnhancementDocumentSchema,
  screeningEvidenceResponseSchema,
  type CvAuditAnalysis,
  type CvEnhancementDocument,
  type ScreeningEvidenceResponse,
} from '@aseb/shared';

import { quoteExistsInSource, sanitizeText, truncate } from '../../utils/text.js';
import { AppError } from '../../utils/errors.js';
import type { PromptPayload, PromptVersionId } from '../../prompts/types.js';
import type {
  AiCallResult,
  AiUsage,
  AIProvider,
  CvAuditInput,
  CvEnhancementInput,
  PortfolioAnalysisInput,
  PortfolioSummary,
  ScreeningEvidenceInput,
} from './types.js';

export interface MockProviderBehaviour {
  /** Fail the next N calls with a provider error. */
  failNext?: number;
  /** Simulate a 429 for the next N calls. */
  rateLimitNext?: number;
  /** Return malformed JSON for the next N calls. */
  invalidJsonNext?: number;
  /** Latency in ms, useful for exercising progress UI. */
  latencyMs?: number;
}

const EMPTY_USAGE: AiUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cachedTokens: 0,
  requestCount: 1,
  estimatedCostUsd: 0,
  targetRevenueUsd: 0,
  pricingKnown: true,
};

/**
 * Deterministic offline provider.
 *
 * Used for development and for the automated test suite, which must never make a real
 * network call. Behaviour is derived from the input so results are reproducible.
 */
export class MockAIProvider implements AIProvider {
  readonly name = 'mock';
  readonly model = 'mock-deterministic-v1';

  private behaviour: MockProviderBehaviour = {};

  configure(behaviour: MockProviderBehaviour): void {
    this.behaviour = { ...behaviour };
  }

  reset(): void {
    this.behaviour = {};
  }

  private consume(kind: 'fail' | 'rateLimit' | 'invalidJson'): void {
    const key = `${kind}Next` as const;
    const remaining = this.behaviour[key] ?? 0;
    if (remaining > 0) {
      this.behaviour = { ...this.behaviour, [key]: remaining - 1 };
      if (kind === 'rateLimit') throw AppError.aiRateLimited(new Error('mock 429'));
      if (kind === 'fail') throw AppError.aiProvider('mock provider failure');
      // The model returned something no schema accepts: exactly the failure a real provider
      // reports after `extractJsonObject` + Zod, so handlers must reject it identically.
      throw AppError.aiInvalidResponse({ reason: 'mock invalid model output' });
    }
  }

  private async result<T>(
    data: T,
    startedAt: number,
    promptVersion: PromptVersionId,
  ): Promise<AiCallResult<T>> {
    const latency = this.behaviour.latencyMs ?? 0;
    if (latency > 0) await new Promise((resolve) => setTimeout(resolve, latency));
    return {
      data,
      usage: { ...EMPTY_USAGE, inputTokens: 1200, outputTokens: 800 },
      provider: this.name,
      model: this.model,
      promptVersion,
      latencyMs: Math.max(latency, Date.now() - startedAt, 1),
    };
  }

  /**
   * Reads a delimited document back out of a composed prompt.
   *
   * The mock honours the same untrusted-data contract as a real provider, so it only
   * looks inside `<untrusted_document>` and never at the surrounding instructions.
   */
  private documentOf(prompt: PromptPayload, name: string): string {
    const userMessage = [...prompt.messages].reverse().find((message) => message.role === 'user');
    const content = userMessage?.content ?? '';
    const match = content.match(
      new RegExp(`<untrusted_document name="${name}">\\n([\\s\\S]*?)\\n</untrusted_document>`),
    );
    // No delimited document means there is nothing to read: the mock never treats the
    // surrounding instructions as candidate data.
    return match?.[1] ?? '';
  }

  /**
   * Reads a labelled structured block (`[KONTEKS: label]` / `[TUGAS: label]`) back out
   * of a composed prompt.
   *
   * The mock consumes the same layered payload a real provider does, so it can never
   * accidentally depend on a raw options object that production no longer sends.
   */
  private blockOf<T>(prompt: PromptPayload, kind: 'KONTEKS' | 'TUGAS', label: string): T | null {
    const userMessage = [...prompt.messages].reverse().find((message) => message.role === 'user');
    const content = userMessage?.content ?? '';
    const match = content.match(
      new RegExp(`\\[${kind}: ${label}\\]\\n([\\s\\S]*?)(?=\\n\\n\\[|\\n\\n<untrusted_document|$)`),
    );
    if (!match?.[1]) return null;
    try {
      return JSON.parse(match[1]) as T;
    } catch {
      return null;
    }
  }

  async analyzeCv(input: CvAuditInput): Promise<AiCallResult<CvAuditAnalysis>> {
    const startedAt = Date.now();
    this.consume('fail');
    this.consume('rateLimit');
    this.consume('invalidJson');

    const text = sanitizeText(this.documentOf(input.prompt, 'cv'));
    const words = text.split(/\s+/).filter(Boolean).length;
    const hasExperience = /pengalaman|experience|worked|internship|magang/i.test(text);
    const hasEducation = /pendidikan|education|universitas|university|sekolah|school/i.test(text);
    const hasSkills = /skill|keahlian|kemampuan|teknis|technical/i.test(text);

    const analysis = cvAuditAnalysisSchema.parse({
      atsScore: Math.min(88, 45 + Math.min(30, Math.floor(words / 20))),
      professionalSummary:
        'Ringkasan profesional terbaca, namun pencapaian masih bersifat umum dan belum menunjukkan dampak yang terukur.',
      strengths: [
        hasExperience
          ? 'Struktur pengalaman kerja tersedia dan dapat dibaca ATS.'
          : 'Format dokumen mudah dibaca mesin.',
        hasSkills ? 'Bagian keahlian teknis tersedia.' : 'Bahasa CV cukup formal.',
      ],
      weaknesses: [
        'Beberapa poin masih berisi tugas harian, bukan hasil atau dampak.',
        'Belum ada angka yang menunjukkan skala pekerjaan.',
      ],
      missingSections: [
        ...(hasEducation ? [] : ['Pendidikan']),
        ...(hasSkills ? [] : ['Keahlian Teknis']),
      ],
      keywordAnalysis: [
        {
          keyword: 'pencapaian terukur',
          status: 'MISSING',
          note: 'Belum ditemukan angka hasil kerja.',
        },
        { keyword: 'tools/teknologi', status: hasSkills ? 'PRESENT' : 'PARTIAL', note: '' },
      ],
      formattingAnalysis: [
        {
          aspect: 'Panjang dokumen',
          status: words > 120 ? 'GOOD' : 'WARNING',
          note: `${words} kata terdeteksi.`,
        },
        { aspect: 'Judul bagian standar', status: 'GOOD', note: '' },
      ],
      improvementSuggestions: [
        {
          title: 'Tambahkan angka pada pencapaian',
          detail:
            'Ubah kalimat tugas menjadi hasil, misalnya dengan menambahkan jumlah, persentase, atau waktu.',
          priority: 'HIGH',
        },
        {
          title: 'Rapikan struktur ATS',
          detail: 'Gunakan satu kolom dan hindari tabel agar teks terbaca berurutan oleh mesin.',
          priority: 'MEDIUM',
        },
      ],
      careerFit: [
        {
          role: 'Software Engineer',
          fit: 70,
          reason: 'Berdasarkan istilah teknis yang muncul pada CV.',
        },
      ],
    });

    return this.result(analysis, startedAt, input.prompt.version);
  }

  async enhanceCv(input: CvEnhancementInput): Promise<AiCallResult<CvEnhancementDocument>> {
    const startedAt = Date.now();
    this.consume('fail');
    this.consume('rateLimit');
    this.consume('invalidJson');

    const text = sanitizeText(this.documentOf(input.prompt, 'cv'));
    const firstLine = text.split('\n').find((line) => line.trim().length > 0) ?? 'Kandidat';
    const name = truncate(firstLine.trim(), 80).text;
    const sourceQuote = truncate(text.replace(/\n+/g, ' '), 200).text;

    const context = this.blockOf<{
      target?: { targetRole?: string; targetCareer?: string } | undefined;
      links?: { githubUrl?: string; linkedinUrl?: string; portfolioUrl?: string } | undefined;
    }>(input.prompt, 'KONTEKS', 'job-seeker-context');
    const links = context?.links ?? {};

    const document = cvEnhancementDocumentSchema.parse({
      fullName: name,
      headline: context?.target?.targetRole ?? null,
      contact: {
        email: null,
        phone: null,
        location: null,
        linkedinUrl: links.linkedinUrl ?? null,
        githubUrl: links.githubUrl ?? null,
        portfolioUrl: links.portfolioUrl ?? null,
      },
      professionalSummary:
        'Profesional yang berfokus pada penyelesaian masalah secara terstruktur, dengan penekanan pada kualitas hasil kerja dan kolaborasi tim.',
      experience: [
        {
          jobTitle: 'Posisi sesuai CV',
          company: 'Perusahaan sesuai CV',
          location: null,
          startDate: null,
          endDate: null,
          current: false,
          summary: null,
          bullets: [
            {
              text: 'Menjalankan tanggung jawab utama dengan alur kerja yang lebih terstruktur dan terdokumentasi.',
              sourceQuote: quoteExistsInSource(sourceQuote, text) ? sourceQuote : null,
            },
          ],
        },
      ],
      projects: [],
      skills: { technical: [], tools: [], soft: [] },
      education: [],
      certifications: [],
      languages: [],
      additionalSections: [],
      changeLog: [
        {
          section: 'Ringkasan Profesional',
          changeType: 'REWORDED',
          description:
            'Ringkasan disusun ulang agar lebih fokus pada kontribusi, tanpa menambah fakta baru.',
        },
      ],
      missingInformation: [
        {
          section: 'Pengalaman',
          message: 'Angka pencapaian (jumlah, persentase, atau dampak) belum tersedia di CV.',
        },
        { section: 'Pendidikan', message: 'Data pendidikan belum terbaca dari CV.' },
      ],
      atsReadinessScore: 72,
    });

    return this.result(document, startedAt, input.prompt.version);
  }

  async extractScreeningEvidence(
    input: ScreeningEvidenceInput,
  ): Promise<AiCallResult<ScreeningEvidenceResponse>> {
    const startedAt = Date.now();
    this.consume('fail');
    this.consume('rateLimit');
    this.consume('invalidJson');

    // The mock reads the composed prompt exactly like a real provider would: the CV from
    // its untrusted delimiter and the criteria from the labelled task block.
    const haystack = sanitizeText(this.documentOf(input.prompt, 'cv'));
    const normalised = haystack.toLowerCase();

    const requested =
      this.blockOf<Array<{ requirementId?: string; kriteria?: string }>>(
        input.prompt,
        'TUGAS',
        'screening-requirements',
      ) ?? [];

    const criteria = requested
      .filter(
        (requirement): requirement is { requirementId: string; kriteria?: string } =>
          typeof requirement?.requirementId === 'string' && requirement.requirementId.length > 0,
      )
      .map((requirement) => {
        const keywords = (requirement.kriteria ?? '')
          .toLowerCase()
          .split(/[^a-z0-9+#.]+/)
          .filter((word) => word.length > 3);

        const hit = keywords.find((keyword) => normalised.includes(keyword));
        if (!hit) {
          return {
            requirementId: requirement.requirementId,
            status: 'NOT_FOUND' as const,
            confidence: 0.15,
            evidence: [],
            notes: 'Tidak ditemukan bukti pendukung pada CV.',
          };
        }

        const index = normalised.indexOf(hit);
        const quote = haystack.slice(Math.max(0, index - 60), index + 140).trim();

        return {
          requirementId: requirement.requirementId,
          status: 'FOUND' as const,
          confidence: 0.82,
          evidence: [
            {
              quote: truncate(quote, 320).text,
              source: 'CV' as const,
              page: null,
              url: null,
              note: null,
            },
          ],
          notes: '',
        };
      });

    const response = screeningEvidenceResponseSchema.parse({
      candidateName: truncate(haystack.split('\n')[0]?.trim() ?? 'Kandidat', 120).text,
      summary: 'Bukti diekstrak dari CV untuk setiap kriteria yang diminta.',
      gaps: criteria
        .filter((item) => item.status === 'NOT_FOUND')
        .map((item) => `Tidak ada bukti: ${item.requirementId}`),
      uncertainties: [],
      criteria,
    });

    return this.result(response, startedAt, input.prompt.version);
  }

  async analyzePortfolio(input: PortfolioAnalysisInput): Promise<AiCallResult<PortfolioSummary>> {
    const startedAt = Date.now();
    this.consume('fail');
    this.consume('invalidJson');

    // Same contract as a real provider: the page comes from its untrusted delimiter.
    const text = sanitizeText(this.documentOf(input.prompt, 'portfolio')).slice(0, 4000);
    const firstLine =
      text
        .split('\n')
        .find((line) => line.trim().length > 0)
        ?.trim() ?? null;
    const summary: PortfolioSummary = {
      reachable: text.length > 0,
      title: firstLine ? truncate(firstLine, 120).text : null,
      summary:
        text.length > 0
          ? 'Halaman portofolio berhasil diambil dan memuat deskripsi proyek.'
          : 'Halaman diambil tetapi tidak memuat teks yang dapat dibaca.',
      apparentSkills: [],
      projectHints: [],
      inconclusive: text.length === 0,
    };

    return this.result(summary, startedAt, input.prompt.version);
  }
}

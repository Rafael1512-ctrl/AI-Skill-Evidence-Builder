import { describe, expect, it } from 'vitest';

import {
  cvAuditAnalysisSchema,
  cvEnhancementDocumentSchema,
  portfolioSummaryResponseSchema,
  recruiterPreferencesSchema,
  screeningEvidenceResponseSchema,
} from '@aseb/shared';

import { MockAIProvider } from '../src/providers/ai/mock.provider.js';
import { buildJobSeekerEnhancementPrompt } from '../src/prompts/jobSeeker/enhancePrompt.js';
import { buildJobSeekerAuditPrompt } from '../src/prompts/jobSeeker/auditPrompt.js';
import { buildHrdEvidenceExtractionPrompt } from '../src/prompts/hrd/evidenceExtractionPrompt.js';
import { buildHrdPortfolioVerificationPrompt } from '../src/prompts/hrd/portfolioVerificationPrompt.js';

/**
 * Provider boundary behaviour (Phase 20).
 *
 * Pure and offline. The four provider methods must each return schema-valid data and carry the
 * version id of the prompt that produced it, and the three failure modes a real vendor can
 * produce - outage, 429, unparseable output - must arrive as typed errors instead of a partial
 * or malformed result that business logic could act on.
 */

const CV_TEXT = 'Siti Aminah\nSoftware Engineer dengan lima tahun pengalaman Node.js dan Docker.';

function provider(): MockAIProvider {
  const instance = new MockAIProvider();
  instance.reset();
  return instance;
}

describe('provider failure modes', () => {
  it('reports an outage as a provider error and stops after the configured count', async () => {
    const mock = provider();
    mock.configure({ failNext: 1 });

    await expect(
      mock.analyzeCv({ prompt: buildJobSeekerAuditPrompt({ cvText: CV_TEXT }) }),
    ).rejects.toMatchObject({ code: 'AI_PROVIDER_ERROR' });
    // The next call is served normally: the behaviour was a countdown, not a latch.
    await expect(
      mock.analyzeCv({ prompt: buildJobSeekerAuditPrompt({ cvText: CV_TEXT }) }),
    ).resolves.toBeTruthy();
  });

  it('reports a 429 as rate limiting, distinctly from an outage', async () => {
    const mock = provider();
    mock.configure({ rateLimitNext: 1 });

    await expect(
      mock.extractScreeningEvidence({ prompt: buildHrdEvidenceExtractionPrompt(screeningInput()) }),
    ).rejects.toMatchObject({ code: 'AI_RATE_LIMITED' });
  });

  it('rejects unparseable model output instead of returning a partial result', async () => {
    const mock = provider();
    mock.configure({ invalidJsonNext: 1 });

    await expect(
      mock.enhanceCv({
        prompt: buildJobSeekerEnhancementPrompt({
          cvText: CV_TEXT,
          templateKey: 'ATS_MINIMAL',
          useProfileContext: false,
        }),
      }),
    ).rejects.toMatchObject({ code: 'AI_INVALID_RESPONSE' });
  });
});

describe('provider results', () => {
  it('returns audit data that validates and names its prompt version', async () => {
    const result = await provider().analyzeCv({
      prompt: buildJobSeekerAuditPrompt({ cvText: CV_TEXT }),
    });

    expect(cvAuditAnalysisSchema.safeParse(result.data).success).toBe(true);
    expect(result.promptVersion).toBe('JOB_SEEKER_AUDIT_V1');
    expect(result.provider).toBe('mock');
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.usage.requestCount).toBe(1);
  });

  it('returns an enhancement document that validates', async () => {
    const result = await provider().enhanceCv({
      prompt: buildJobSeekerEnhancementPrompt({
        cvText: CV_TEXT,
        templateKey: 'ATS_MINIMAL',
        useProfileContext: false,
      }),
    });

    expect(cvEnhancementDocumentSchema.safeParse(result.data).success).toBe(true);
    expect(result.promptVersion).toBe('JOB_SEEKER_ENHANCE_V1');
  });

  it('returns screening evidence keyed by the requested requirement ids', async () => {
    const result = await provider().extractScreeningEvidence({
      prompt: buildHrdEvidenceExtractionPrompt(screeningInput()),
    });

    expect(screeningEvidenceResponseSchema.safeParse(result.data).success).toBe(true);
    expect(result.promptVersion).toBe('HRD_EVIDENCE_EXTRACTION_V1');
    expect(result.data.criteria.map((criterion) => criterion.requirementId)).toEqual(['req-1']);
    // The requirement asks for Node.js and the CV mentions it.
    expect(result.data.criteria[0]?.status).toBe('FOUND');
  });

  it('summarises a portfolio page read from the composed prompt', async () => {
    const result = await provider().analyzePortfolio({
      prompt: buildHrdPortfolioVerificationPrompt({
        url: 'https://andi.dev',
        source: 'PORTFOLIO',
        pageText: 'Andi - proyek Node.js dan PostgreSQL.',
      }),
    });

    expect(portfolioSummaryResponseSchema.safeParse(result.data).success).toBe(true);
    expect(result.data.reachable).toBe(true);
    expect(result.data.inconclusive).toBe(false);
    expect(result.promptVersion).toBe('HRD_PORTFOLIO_VERIFICATION_V1');
  });

  it('reports an unreadable page as inconclusive rather than inventing a summary', async () => {
    const result = await provider().analyzePortfolio({
      prompt: buildHrdPortfolioVerificationPrompt({
        url: 'https://andi.dev',
        source: 'PORTFOLIO',
        pageText: '',
      }),
    });

    expect(result.data.inconclusive).toBe(true);
    expect(result.data.reachable).toBe(false);
  });
});

function screeningInput() {
  return {
    jobTitle: 'Backend Engineer',
    jobDescription: 'Kami mencari backend engineer dengan Node.js.',
    requirements: [
      {
        requirementId: 'req-1',
        text: 'Pengalaman Node.js',
        category: 'TECHNICAL_SKILLS' as const,
        requirementClass: 'REQUIRED',
        weight: 30,
        hardRequirement: true,
      },
    ],
    preferenceVersion: 0,
    preferences: recruiterPreferencesSchema.parse({}),
    scoringConfigurationVersion: '1.0.0',
    cvText: CV_TEXT,
  };
}

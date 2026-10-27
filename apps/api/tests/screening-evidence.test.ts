import { describe, expect, it } from 'vitest';

import {
  candidateEvidenceEnvelopeSchema,
  recruiterPreferencesSchema,
  screeningEvidenceResponseSchema,
  type RecruiterPreferences,
  type ScreeningEvidenceResponse,
} from '@aseb/shared';

import type { AIProvider, AiCallResult } from '../src/providers/ai/types.js';
import { MockAIProvider } from '../src/providers/ai/mock.provider.js';
import type { PromptPayload } from '../src/prompts/types.js';
import {
  ScreeningEvidenceService,
  type ScreeningEvidenceServiceDeps,
} from '../src/services/screening-evidence.service.js';
import type { RecruiterPreferenceService } from '../src/services/recruiter-preference.service.js';
import { groundScreeningEvidence } from '../src/utils/evidence.js';
import type { CandidateProcessingContext } from '../src/workers/screening.processor.js';

/**
 * Evidence extraction logic. Pure and offline: the provider, the preference snapshot and the
 * usage recorder are injected, so no AI call and no database are involved.
 *
 * The AI never scores: these tests pin grounding (an unverifiable quote is dropped and can
 * only downgrade a verdict), the audit envelope that records which versions produced the
 * result, and the fact that nothing is stored when the model returns junk.
 */

const CV_TEXT = [
  'Andi Pratama',
  'Software Engineer dengan lima tahun pengalaman Node.js dan PostgreSQL.',
  'Memimpin tim kecil berisi empat orang pada proyek migrasi layanan.',
].join('\n');

function criterion(overrides: Partial<ScreeningEvidenceResponse['criteria'][number]> = {}) {
  return {
    requirementId: 'req-1',
    status: 'FOUND' as const,
    confidence: 0.8,
    evidence: [
      {
        quote: 'lima tahun pengalaman Node.js dan PostgreSQL',
        source: 'CV' as const,
        page: 2,
        url: null,
        note: null,
      },
    ],
    notes: '',
    ...overrides,
  };
}

function response(overrides: Partial<ScreeningEvidenceResponse> = {}): ScreeningEvidenceResponse {
  return screeningEvidenceResponseSchema.parse({
    candidateName: 'Andi Pratama',
    summary: 'Bukti ditemukan untuk kriteria utama.',
    gaps: [],
    uncertainties: [],
    criteria: [criterion()],
    ...overrides,
  });
}

const SOURCES = [{ source: 'CV' as const, text: CV_TEXT }];

describe('evidence grounding', () => {
  it('keeps a quote that really exists in the CV', () => {
    const grounded = groundScreeningEvidence(response(), SOURCES);
    const [result] = grounded.data.criteria;

    expect(result?.status).toBe('FOUND');
    expect(result?.evidence).toHaveLength(1);
    expect(grounded.summary).toEqual({
      droppedQuotes: 0,
      downgradedCriteria: 0,
      pageVerification: 'unavailable',
    });
  });

  it('drops the model page number because pages cannot be verified', () => {
    const grounded = groundScreeningEvidence(response(), SOURCES);

    expect(grounded.data.criteria[0]?.evidence[0]?.page).toBeNull();
  });

  it('downgrades FOUND to UNCERTAIN when no quote can be found, and drops the quote', () => {
    const grounded = groundScreeningEvidence(
      response({
        criteria: [
          criterion({
            evidence: [
              {
                quote: 'sepuluh tahun memimpin organisasi internasional',
                source: 'CV',
                page: null,
                url: null,
                note: null,
              },
            ],
          }),
        ],
      }),
      SOURCES,
    );

    expect(grounded.data.criteria[0]?.status).toBe('UNCERTAIN');
    expect(grounded.data.criteria[0]?.evidence).toEqual([]);
    expect(grounded.data.criteria[0]?.notes).toContain('diturunkan menjadi UNCERTAIN');
    expect(grounded.summary.downgradedCriteria).toBe(1);
    expect(grounded.summary.droppedQuotes).toBe(1);
  });

  it('never upgrades a verdict: NOT_FOUND stays NOT_FOUND without quotes', () => {
    const grounded = groundScreeningEvidence(
      response({ criteria: [criterion({ status: 'NOT_FOUND' })] }),
      SOURCES,
    );

    expect(grounded.data.criteria[0]?.status).toBe('NOT_FOUND');
    expect(grounded.data.criteria[0]?.evidence).toEqual([]);
    expect(grounded.data.criteria[0]?.notes).toContain('tidak ditemukan pada sumber');
  });

  it('keeps only the verifiable quotes of an UNCERTAIN criterion', () => {
    const grounded = groundScreeningEvidence(
      response({
        criteria: [
          criterion({
            status: 'UNCERTAIN',
            evidence: [
              {
                quote: 'Memimpin tim kecil berisi empat orang',
                source: 'CV',
                page: null,
                url: null,
                note: null,
              },
              {
                quote: 'kalimat yang tidak ada di CV mana pun',
                source: 'CV',
                page: null,
                url: null,
                note: null,
              },
            ],
          }),
        ],
      }),
      SOURCES,
    );

    expect(grounded.data.criteria[0]?.status).toBe('UNCERTAIN');
    expect(grounded.data.criteria[0]?.evidence).toHaveLength(1);
    expect(grounded.summary.droppedQuotes).toBe(1);
  });

  it('treats a quote from a source it does not hold as unverifiable', () => {
    const grounded = groundScreeningEvidence(
      response({
        criteria: [
          criterion({
            evidence: [
              { quote: 'proyek open source', source: 'GITHUB', page: null, url: null, note: null },
            ],
          }),
        ],
      }),
      SOURCES,
    );

    expect(grounded.data.criteria[0]?.status).toBe('UNCERTAIN');
    expect(grounded.data.criteria[0]?.evidence).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* Service (injected provider, preferences and usage recorder)                 */
/* -------------------------------------------------------------------------- */

interface FakeProvider {
  provider: AIProvider;
  prompts: Array<{ version: string; user: string }>;
}

function fakeProvider(data: ScreeningEvidenceResponse): FakeProvider {
  const prompts: FakeProvider['prompts'] = [];
  const provider = {
    name: 'fake',
    model: 'fake-v1',
    async extractScreeningEvidence({
      prompt,
    }: {
      prompt: PromptPayload;
    }): Promise<AiCallResult<ScreeningEvidenceResponse>> {
      prompts.push({
        version: prompt.version,
        user: prompt.messages.find((message) => message.role === 'user')?.content ?? '',
      });
      return {
        data,
        usage: {
          inputTokens: 10,
          outputTokens: 5,
          cachedTokens: 0,
          requestCount: 1,
          estimatedCostUsd: 0,
          targetRevenueUsd: 0,
          pricingKnown: true,
        },
        provider: 'fake',
        model: 'fake-v1',
        promptVersion: prompt.version,
        latencyMs: 1,
      };
    },
  } as unknown as AIProvider;

  return { provider, prompts };
}

function context(overrides: { cvText?: string | null; candidateName?: string } = {}) {
  return {
    candidate: {
      id: 'cand_1',
      jobId: 'job_1',
      candidateName: overrides.candidateName ?? 'andi.pdf',
      cvText: overrides.cvText === undefined ? CV_TEXT : overrides.cvText,
    },
    job: {
      id: 'job_1',
      userId: 'user_1',
      title: 'Backend Engineer',
      description: 'Kami mencari backend engineer dengan Node.js.',
      preferenceVersion: 4,
      scoringConfigurationVersion: '1.0.0',
      requirementVersion: 1,
      categoryWeights: null,
      requirements: [
        {
          id: 'req-1',
          sortOrder: 1,
          text: 'Pengalaman minimal 3 tahun dengan Node.js',
          category: 'TECHNICAL_SKILLS',
          requirementClass: 'REQUIRED',
          weight: 30,
          hardRequirement: true,
        },
      ],
    },
  } as unknown as CandidateProcessingContext;
}

function service(options: {
  data?: ScreeningEvidenceResponse;
  preferences?: Partial<RecruiterPreferences>;
}) {
  const { provider, prompts } = fakeProvider(options.data ?? response());
  const usageCalls: Array<Record<string, unknown>> = [];
  const preferences = {
    getVersion: async (): Promise<RecruiterPreferences> =>
      recruiterPreferencesSchema.parse(options.preferences ?? {}),
  } as unknown as RecruiterPreferenceService;

  const deps: ScreeningEvidenceServiceDeps = {
    provider: () => provider,
    preferences,
    usage: async (input) => {
      usageCalls.push(input as unknown as Record<string, unknown>);
    },
  };
  const instance = new ScreeningEvidenceService(deps);

  return { instance, prompts, usageCalls };
}

describe('screening evidence service', () => {
  it('returns grounded evidence in the audit envelope for the runner to store', async () => {
    const { instance } = service({});

    const result = await instance.extract(context());

    expect(result.summary).toBe('Bukti ditemukan untuk kriteria utama.');
    expect(result.candidateName).toBe('Andi Pratama');

    const envelope = candidateEvidenceEnvelopeSchema.parse(result.analysis);
    expect(envelope.promptVersion).toBe('HRD_EVIDENCE_EXTRACTION_V1');
    expect(envelope.preferenceVersion).toBe(4);
    expect(envelope.scoringConfigurationVersion).toBe('1.0.0');
    expect(envelope.requirementVersion).toBe(1);
    expect(envelope.evidence.criteria).toHaveLength(1);
    expect(envelope.grounding.pageVerification).toBe('unavailable');
  });

  it('grounds the model output before it can be stored', async () => {
    const { instance } = service({
      data: response({
        criteria: [
          criterion({
            evidence: [
              {
                quote: 'fakta yang tidak ada di CV',
                source: 'CV',
                page: null,
                url: null,
                note: null,
              },
            ],
          }),
        ],
      }),
    });

    const envelope = candidateEvidenceEnvelopeSchema.parse(
      (await instance.extract(context())).analysis,
    );

    expect(envelope.evidence.criteria[0]?.status).toBe('UNCERTAIN');
    expect(envelope.evidence.criteria[0]?.evidence).toEqual([]);
    expect(envelope.grounding.downgradedCriteria).toBe(1);
  });

  it('sends the extraction prompt with the frozen preference version', async () => {
    const { instance, prompts } = service({ preferences: { preferredSkills: ['TypeScript'] } });

    await instance.extract(context());

    expect(prompts).toHaveLength(1);
    expect(prompts[0]?.version).toBe('HRD_EVIDENCE_EXTRACTION_V1');
    expect(prompts[0]?.user).toContain('"version": 4');
    expect(prompts[0]?.user).toContain('"TypeScript"');
    expect(prompts[0]?.user).toContain('[TUGAS: screening-requirements]');
    expect(prompts[0]?.user).toContain('<untrusted_document name="cv">');
  });

  it('records provider cost against the feature and the candidate', async () => {
    const { instance, usageCalls } = service({});

    await instance.extract(context());

    expect(usageCalls).toHaveLength(1);
    expect(usageCalls[0]).toMatchObject({
      userId: 'user_1',
      feature: 'HRD_SCREEN_PER_CV',
      screeningJobId: 'job_1',
      screeningCandidateId: 'cand_1',
    });
  });

  it('refuses to run without stored CV text instead of asking the model', async () => {
    const { instance, prompts } = service({});

    await expect(instance.extract(context({ cvText: '   ' }))).rejects.toMatchObject({
      code: 'TEXT_EXTRACTION_FAILED',
    });
    expect(prompts).toEqual([]);
  });

  it('falls back to the file-derived label when the model returns no name', async () => {
    const { instance } = service({ data: response({ candidateName: null }) });

    const result = await instance.extract(context({ candidateName: 'andi.pdf' }));

    expect(result.candidateName).toBeUndefined();
  });

  it('round-trips the composed prompt through the real mock provider', async () => {
    // No injected provider: this exercises the same path production uses, minus the vendor.
    const preferences = {
      getVersion: async (): Promise<RecruiterPreferences> => recruiterPreferencesSchema.parse({}),
    } as unknown as RecruiterPreferenceService;
    const instance = new ScreeningEvidenceService({
      provider: () => new MockAIProvider(),
      preferences,
      usage: async () => undefined,
    });

    const result = await instance.extract(context());
    const envelope = candidateEvidenceEnvelopeSchema.parse(result.analysis);
    const [criterionResult] = envelope.evidence.criteria;

    expect(envelope.provider).toBe('mock');
    expect(envelope.promptVersion).toBe('HRD_EVIDENCE_EXTRACTION_V1');
    // The requirement asks for Node.js and the CV mentions it, so the mock reports FOUND
    // with a real quote - and grounding keeps it.
    expect(criterionResult).toMatchObject({ requirementId: 'req-1', status: 'FOUND' });
    expect(criterionResult?.evidence).toHaveLength(1);
    expect(result.summary).toBeTruthy();
    expect(result.candidateName).toBe('Andi Pratama');
  });

  it('propagates a provider failure without recording usage or an envelope', async () => {
    const preferences = {
      getVersion: async (): Promise<RecruiterPreferences> => recruiterPreferencesSchema.parse({}),
    } as unknown as RecruiterPreferenceService;
    const mock = new MockAIProvider();
    mock.configure({ invalidJsonNext: 1 });
    const usageCalls: unknown[] = [];
    const instance = new ScreeningEvidenceService({
      provider: () => mock,
      preferences,
      usage: async (input) => {
        usageCalls.push(input);
      },
    });

    // Unparseable model output must fail the whole extraction: no envelope is produced for the
    // runner to store, and no provider-cost row is written for a call that returned nothing.
    await expect(instance.extract(context())).rejects.toMatchObject({
      code: 'AI_INVALID_RESPONSE',
    });
    expect(usageCalls).toEqual([]);
  });
});

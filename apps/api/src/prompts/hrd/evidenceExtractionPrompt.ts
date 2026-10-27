import {
  SCORING_CATEGORY_LABELS,
  type RecruiterPreferences,
  type ScoringCategory,
} from '@aseb/shared';

import { ANTI_FABRICATION_POLICY } from '../global/antiFabricationPolicy.js';
import { EVIDENCE_POLICY } from '../global/evidencePolicy.js';
import { UNTRUSTED_DATA_POLICY } from '../global/promptInjectionPolicy.js';
import { buildPrompt, type StructuredBlock } from '../promptBuilder.js';
import type { PromptPayload, PromptVersionId } from '../types.js';

/**
 * `HRD_EVIDENCE_EXTRACTION_V1` - the prompt that produces a screening result.
 *
 * One call per candidate. It frames the screening job (requirements + the frozen
 * recruiter preference version + the frozen scoring configuration) and hands the model
 * exactly one job: report what the CV actually supports. The model never scores, ranks or
 * decides - that is Phase 14's deterministic engine.
 *
 * `HRD_SCREENING_V1` (`screeningPrompt.ts`) records *which context composed this job* and
 * is persisted on `ScreeningJob.promptVersion`; this version records *which prompt produced
 * this call* and is persisted per candidate. See docs/AI_PROMPTS.md §14.1.
 */
export const HRD_EVIDENCE_EXTRACTION_PROMPT_VERSION =
  'HRD_EVIDENCE_EXTRACTION_V1' satisfies PromptVersionId;

/** Evidence extraction must be as reproducible as the model allows. */
export const HRD_EVIDENCE_EXTRACTION_TEMPERATURE = 0.05;

const HRD_SCREENING_FEATURE_PROMPT = `Anda adalah asisten penilai CV untuk platform AI Skill Evidence Builder, bekerja untuk perekrut.

Tugas Anda HANYA mengekstrak bukti dari CV kandidat untuk setiap kriteria yang diberikan.

Anda TIDAK menghitung skor, TIDAK memberi peringkat, dan TIDAK mengambil keputusan
rekrutmen. Bobot, kelas kriteria, dan konfigurasi skor hanya informasi konteks: semuanya
dipakai oleh mesin skor deterministik di luar Anda. Jangan mengubah, menurunkan, atau
menghitung ulang bobot apa pun.

Bersikaplah konservatif. Jika bukti tidak ada, gunakan NOT_FOUND. Jika ambigu atau hanya
tersirat, gunakan UNCERTAIN. Jangan pernah mengisi kekosongan dengan asumsi.

Setiap bukti harus berupa kutipan pendek yang benar-benar ada di sumber, bukan parafrase
dan bukan rangkuman panjang. Jangan menyimpulkan ketidakjujuran, karakter, atau atribut
pribadi yang dilindungi.

SKEMA JSON WAJIB:
{
  "candidateName": string|null,
  "summary": string,
  "gaps": string[],
  "uncertainties": string[],
  "criteria": [
    {
      "requirementId": string,
      "status": "FOUND"|"NOT_FOUND"|"UNCERTAIN",
      "confidence": number (0..1),
      "evidence": [{ "quote": string, "source": "CV"|"GITHUB"|"PORTFOLIO"|"LINKEDIN_SELF_REPORTED"|"USER_INPUT"|"JOB_DESCRIPTION", "page": number|null, "url": string|null, "note": string|null }],
      "notes": string
    }
  ]
}
Setiap requirementId yang diberikan WAJIB muncul tepat satu kali pada array criteria, tanpa
kriteria tambahan yang tidak diminta.`;

export interface HrdScreeningRequirementContext {
  readonly requirementId: string;
  readonly text: string;
  readonly category: ScoringCategory;
  readonly requirementClass: string;
  readonly weight: number;
  readonly hardRequirement: boolean;
}

export interface HrdExternalEvidenceContext {
  /** Document label; sanitised by `wrapUntrusted` before it reaches the prompt. */
  readonly name: string;
  readonly content: string;
}

export interface BuildHrdScreeningPromptInput {
  readonly jobTitle: string;
  readonly jobDescription: string;
  readonly requirements: readonly HrdScreeningRequirementContext[];
  /** The frozen `RecruiterPreference.version` for this job (0 = shared defaults). */
  readonly preferenceVersion: number;
  readonly preferences: RecruiterPreferences;
  readonly scoringConfigurationVersion: string;
  readonly categoryWeights?: Readonly<Record<string, number>> | null | undefined;
  readonly cvText: string;
  /** Verified GitHub / portfolio extracts. Always untrusted, always last. */
  readonly externalEvidence?: readonly HrdExternalEvidenceContext[] | undefined;
}

/** Drops empty preference lists so the context block stays small and unambiguous. */
function compactPreferences(preferences: RecruiterPreferences): Record<string, unknown> {
  const compact = Object.fromEntries(
    Object.entries(preferences).filter(([, value]) => {
      if (Array.isArray(value)) return value.length > 0;
      if (typeof value === 'string') return value.length > 0;
      return value !== null && value !== undefined;
    }),
  );
  // Portfolio importance is a real signal even at its neutral default.
  compact.portfolioImportance = preferences.portfolioImportance;
  return compact;
}

/**
 * Composes the screening call.
 *
 * Layer order: global policy + the feature prompt (system), then the recruiter
 * preference/scoring context, the requirements and task parameters, and finally the
 * untrusted documents (job description, CV, verified external evidence).
 */
export function buildHrdPrompt(
  input: BuildHrdScreeningPromptInput,
  options: { version: PromptVersionId; temperature: number },
): PromptPayload {
  const context: StructuredBlock[] = [
    {
      label: 'recruiter-preference-version',
      value: {
        version: input.preferenceVersion,
        preferences: compactPreferences(input.preferences),
      },
    },
    {
      label: 'scoring-configuration',
      value: {
        version: input.scoringConfigurationVersion,
        categoryWeights: input.categoryWeights ?? null,
        catatan:
          'Skor akhir, peringkat, dan keputusan dihitung mesin deterministik, bukan oleh model.',
      },
    },
  ];

  const task: StructuredBlock[] = [
    {
      label: 'screening-requirements',
      value: input.requirements.map((requirement) => ({
        requirementId: requirement.requirementId,
        kriteria: requirement.text,
        kategori: requirement.category,
        labelKategori: SCORING_CATEGORY_LABELS[requirement.category],
        kelas: requirement.requirementClass,
        wajibDipenuhi: requirement.hardRequirement,
        bobot: requirement.weight,
      })),
    },
    {
      label: 'screening-task',
      value: {
        posisi: input.jobTitle,
        tugas: 'ekstraksi bukti per kriteria',
        bahasaKeluaran: 'id',
      },
    },
  ];

  const documents = [
    { name: 'job-description', content: input.jobDescription },
    { name: 'cv', content: input.cvText },
    ...(input.externalEvidence ?? []).map((document) => ({
      name: document.name,
      content: document.content,
    })),
  ];

  return buildPrompt({
    version: options.version,
    temperature: options.temperature,
    featurePrompt: HRD_SCREENING_FEATURE_PROMPT,
    policyBlocks: [EVIDENCE_POLICY, ANTI_FABRICATION_POLICY, UNTRUSTED_DATA_POLICY],
    context,
    task,
    documents,
  });
}

/** The per-candidate evidence extraction call. */
export function buildHrdEvidenceExtractionPrompt(
  input: BuildHrdScreeningPromptInput,
): PromptPayload {
  return buildHrdPrompt(input, {
    version: HRD_EVIDENCE_EXTRACTION_PROMPT_VERSION,
    temperature: HRD_EVIDENCE_EXTRACTION_TEMPERATURE,
  });
}

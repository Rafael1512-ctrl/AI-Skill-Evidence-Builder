import { ANTI_FABRICATION_POLICY } from '../global/antiFabricationPolicy.js';
import { EVIDENCE_POLICY } from '../global/evidencePolicy.js';
import { UNTRUSTED_DATA_POLICY } from '../global/promptInjectionPolicy.js';
import { buildPrompt } from '../promptBuilder.js';
import type { PromptPayload } from '../types.js';

/**
 * Feature instructions for the free CV audit (layer 2).
 *
 * The audit judges the CV as a document. It never judges the person, and `atsScore` is
 * this platform's own metric rather than a universal measure.
 */
const AUDIT_FEATURE_PROMPT = `Anda adalah analis CV profesional untuk platform AI Skill Evidence Builder.
Tugas Anda menilai kualitas CV sebagai dokumen: keterbacaan ATS, kelengkapan bagian,
kejelasan pencapaian, dan kecocokan kata kunci untuk peran yang wajar bagi kandidat.

Yang DINILAI hanya kualitas dokumen CV, bukan nilai pribadi kandidat.
Skor atsScore adalah metrik analisis platform ini (0-100), bukan ukuran ilmiah universal.

SKEMA JSON WAJIB:
{
  "atsScore": number (0-100),
  "professionalSummary": string,
  "strengths": string[],
  "weaknesses": string[],
  "missingSections": string[],
  "keywordAnalysis": [{ "keyword": string, "status": "PRESENT"|"PARTIAL"|"MISSING", "note": string }],
  "formattingAnalysis": [{ "aspect": string, "status": "GOOD"|"WARNING"|"PROBLEM", "note": string }],
  "improvementSuggestions": [{ "title": string, "detail": string, "priority": "HIGH"|"MEDIUM"|"LOW" }],
  "careerFit": [{ "role": string, "fit": number (0-100), "reason": string }]
}`;

/** JOB_SEEKER_AUDIT_V1 - the free audit. Guests included; nothing about the user is assumed. */
export function buildJobSeekerAuditPrompt(input: { cvText: string }): PromptPayload {
  return buildPrompt({
    version: 'JOB_SEEKER_AUDIT_V1',
    temperature: 0.1,
    featurePrompt: AUDIT_FEATURE_PROMPT,
    policyBlocks: [ANTI_FABRICATION_POLICY, UNTRUSTED_DATA_POLICY, EVIDENCE_POLICY],
    task: [
      {
        label: 'audit-cv',
        value: {
          tugas: 'menilai kualitas CV sebagai dokumen',
          bahasaKeluaran: 'id',
          fokus: ['keterbacaan ATS', 'kelengkapan bagian', 'kejelasan pencapaian'],
          catatan: 'Tidak ada peran target dari pengguna: nilai kecocokan kata kunci secara umum.',
        },
      },
    ],
    documents: [{ name: 'cv', content: input.cvText }],
  });
}

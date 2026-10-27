import { ANTI_FABRICATION_POLICY } from '../global/antiFabricationPolicy.js';
import { UNTRUSTED_DATA_POLICY } from '../global/promptInjectionPolicy.js';
import { buildPrompt, type StructuredBlock } from '../promptBuilder.js';
import type { PromptPayload } from '../types.js';

/**
 * Feature instructions for the paid CV enhancement (layer 2).
 *
 * The enhancer may rewrite, restructure and ATS-tune the CV, but every bullet must
 * either quote the source CV (`sourceQuote`) or be a pure wording change. Anything the
 * model cannot find belongs in `missingInformation`, never in an invented fact.
 */
const ENHANCE_FEATURE_PROMPT = `Anda adalah penulis CV profesional untuk platform AI Skill Evidence Builder.
Tugas Anda menyempurnakan CV yang sudah ada agar lebih jelas, lebih terstruktur, dan lebih
ramah ATS, TANPA menambahkan fakta baru apa pun.

Setiap poin pengalaman/proyek harus menyertakan sourceQuote: potongan teks asli dari CV yang
menjadi dasar poin tersebut. Jika sebuah poin murni perbaikan gaya tanpa dasar di CV,
sourceQuote harus null dan poin tersebut tidak boleh memuat klaim baru.

Informasi yang tidak ditemukan di CV (misalnya angka pencapaian, tanggal, atau teknologi)
TIDAK boleh dikarang. Cantumkan pada "missingInformation" agar pengguna mengisinya sendiri.

Tautan GitHub/LinkedIn/portofolio hanya boleh ditampilkan jika diberikan pengguna. Jangan
mengarang nama repository, proyek, atau isi akun mana pun.

SKEMA JSON WAJIB:
{
  "fullName": string,
  "headline": string|null,
  "contact": { "email": string|null, "phone": string|null, "location": string|null, "linkedinUrl": string|null, "githubUrl": string|null, "portfolioUrl": string|null },
  "professionalSummary": string,
  "experience": [{ "jobTitle": string, "company": string, "location": string|null, "startDate": string|null, "endDate": string|null, "current": boolean, "summary": string|null, "bullets": [{ "text": string, "sourceQuote": string|null }] }],
  "projects": [{ "name": string, "role": string|null, "description": string|null, "technologies": string[], "bullets": [{ "text": string, "sourceQuote": string|null }], "url": string|null, "sourceQuote": string|null }],
  "skills": { "technical": string[], "tools": string[], "soft": string[] },
  "education": [{ "institution": string, "degree": string|null, "field": string|null, "startDate": string|null, "endDate": string|null, "grade": string|null, "details": string[] }],
  "certifications": [{ "name": string, "issuer": string|null, "issuedAt": string|null, "credentialId": string|null }],
  "languages": string[],
  "additionalSections": [{ "title": string, "items": string[] }],
  "changeLog": [{ "section": string, "changeType": "REWORDED"|"RESTRUCTURED"|"REORDERED"|"ATS_KEYWORDS"|"CLARIFIED", "description": string }],
  "missingInformation": [{ "section": string, "message": string }],
  "atsReadinessScore": number (0-100)
}`;

/** Saved profile data, used as framing context only when the user consents. */
export interface JobSeekerProfileContext {
  readonly fullName?: string | null | undefined;
  readonly headline?: string | null | undefined;
  readonly location?: string | null | undefined;
  readonly githubUrl?: string | null | undefined;
  readonly linkedinUrl?: string | null | undefined;
  readonly portfolioUrl?: string | null | undefined;
}

/** Links supplied in the current request: explicit consent to display them verbatim. */
export interface JobSeekerLinkedEvidence {
  readonly githubUrl?: string | undefined;
  readonly linkedinUrl?: string | undefined;
  readonly portfolioUrl?: string | undefined;
}

export interface BuildJobSeekerEnhancementPromptInput {
  readonly cvText: string;
  readonly templateKey: string;
  /** Consent gate: when false, no saved profile value is included. */
  readonly useProfileContext: boolean;
  readonly targetCareer?: string | undefined;
  readonly targetPosition?: string | undefined;
  readonly profile?: JobSeekerProfileContext | undefined;
  readonly links?: JobSeekerLinkedEvidence | undefined;
  /** Free-form user instruction, treated as untrusted data. */
  readonly additionalNotes?: string | undefined;
}

/** Drops absent values so the emitted JSON block stays small and unambiguous. */
function compact(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).filter(
      ([, value]) => value !== null && value !== undefined && value !== '',
    ),
  );
}

function nonEmpty(value: Record<string, unknown>): Record<string, unknown> | undefined {
  return Object.keys(value).length > 0 ? value : undefined;
}

/**
 * JOB_SEEKER_ENHANCE_V1 - the paid CV enhancement.
 *
 * Layers: global policy + feature prompt (system), then the structured job-seeker
 * context, the task parameters, and finally the untrusted CV text and user notes. The
 * saved profile is only included when the caller passes `useProfileContext: true`.
 */
export function buildJobSeekerEnhancementPrompt(
  input: BuildJobSeekerEnhancementPromptInput,
): PromptPayload {
  const profile = input.useProfileContext
    ? compact({
        nama: input.profile?.fullName,
        headline: input.profile?.headline,
        lokasi: input.profile?.location,
      })
    : {};

  const links = compact({
    githubUrl: input.links?.githubUrl ?? (input.useProfileContext ? input.profile?.githubUrl : undefined),
    linkedinUrl:
      input.links?.linkedinUrl ?? (input.useProfileContext ? input.profile?.linkedinUrl : undefined),
    portfolioUrl:
      input.links?.portfolioUrl ??
      (input.useProfileContext ? input.profile?.portfolioUrl : undefined),
  });

  const contextValue = compact({
    consent: {
      profileContext: input.useProfileContext,
      linkedEvidence: Object.keys(links).length > 0,
    },
    target: nonEmpty(
      compact({ targetRole: input.targetPosition, targetCareer: input.targetCareer }),
    ),
    profile: input.useProfileContext ? nonEmpty(profile) : undefined,
    links: nonEmpty(links),
  });

  const context: StructuredBlock[] = [{ label: 'job-seeker-context', value: contextValue }];

  const task: StructuredBlock[] = [
    {
      label: 'penyempurnaan-cv',
      value: {
        tugas: 'menyempurnakan CV yang ada tanpa menambah fakta baru',
        bahasaKeluaran: 'id',
        templateKeluaran: input.templateKey,
      },
    },
  ];

  const documents = [
    { name: 'cv', content: input.cvText },
    ...(input.additionalNotes
      ? [{ name: 'catatan-pengguna', content: input.additionalNotes }]
      : []),
  ];

  return buildPrompt({
    version: 'JOB_SEEKER_ENHANCE_V1',
    temperature: 0.2,
    featurePrompt: ENHANCE_FEATURE_PROMPT,
    policyBlocks: [ANTI_FABRICATION_POLICY, UNTRUSTED_DATA_POLICY],
    context,
    task,
    documents,
  });
}

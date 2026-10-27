import { z } from 'zod';

import { CV_TEMPLATE_KEYS } from '../constants/workflow.js';
import { optionalUrlSchema, shortTextSchema } from './common.js';

/**
 * Anti-fabrication contract.
 *
 * Every generated bullet carries an optional `sourceQuote` copied from the original
 * CV. A bullet WITHOUT a source quote is only acceptable when it is a structural or
 * wording improvement, never when it introduces a new fact. Anything the model could
 * not find must be reported in `missingInformation` instead of being invented.
 */
export const cvBulletSchema = z.object({
  text: z.string().min(1).max(600),
  sourceQuote: z.string().max(600).nullable().default(null),
});

export type CvBullet = z.infer<typeof cvBulletSchema>;

export const cvExperienceItemSchema = z.object({
  jobTitle: shortTextSchema,
  company: shortTextSchema,
  location: z.string().max(160).nullable().default(null),
  startDate: z.string().max(60).nullable().default(null),
  endDate: z.string().max(60).nullable().default(null),
  current: z.boolean().default(false),
  summary: z.string().max(600).nullable().default(null),
  bullets: z.array(cvBulletSchema).max(12).default([]),
});

export const cvProjectItemSchema = z.object({
  name: shortTextSchema,
  role: z.string().max(160).nullable().default(null),
  description: z.string().max(800).nullable().default(null),
  technologies: z.array(z.string().max(60)).max(20).default([]),
  bullets: z.array(cvBulletSchema).max(8).default([]),
  url: z.string().max(2048).nullable().default(null),
  sourceQuote: z.string().max(600).nullable().default(null),
});

export const cvEducationItemSchema = z.object({
  institution: shortTextSchema,
  degree: z.string().max(200).nullable().default(null),
  field: z.string().max(200).nullable().default(null),
  startDate: z.string().max(60).nullable().default(null),
  endDate: z.string().max(60).nullable().default(null),
  grade: z.string().max(60).nullable().default(null),
  details: z.array(z.string().max(400)).max(8).default([]),
});

export const cvCertificationItemSchema = z.object({
  name: shortTextSchema,
  issuer: z.string().max(200).nullable().default(null),
  issuedAt: z.string().max(60).nullable().default(null),
  credentialId: z.string().max(120).nullable().default(null),
});

export const cvSkillsSchema = z.object({
  technical: z.array(z.string().max(80)).max(60).default([]),
  tools: z.array(z.string().max(80)).max(60).default([]),
  soft: z.array(z.string().max(80)).max(40).default([]),
});

export const cvChangeLogEntrySchema = z.object({
  section: shortTextSchema,
  changeType: z.enum(['REWORDED', 'RESTRUCTURED', 'REORDERED', 'ATS_KEYWORDS', 'CLARIFIED']),
  description: z.string().min(1).max(400),
});

export const cvMissingInformationSchema = z.object({
  section: shortTextSchema,
  message: z.string().min(1).max(400),
});

export const cvEnhancementDocumentSchema = z.object({
  fullName: shortTextSchema,
  headline: z.string().max(200).nullable().default(null),
  contact: z.object({
    email: z.string().max(320).nullable().default(null),
    phone: z.string().max(60).nullable().default(null),
    location: z.string().max(160).nullable().default(null),
    linkedinUrl: z.string().max(2048).nullable().default(null),
    githubUrl: z.string().max(2048).nullable().default(null),
    portfolioUrl: z.string().max(2048).nullable().default(null),
  }),
  professionalSummary: z.string().min(1).max(2000),
  experience: z.array(cvExperienceItemSchema).max(20).default([]),
  projects: z.array(cvProjectItemSchema).max(20).default([]),
  skills: cvSkillsSchema,
  education: z.array(cvEducationItemSchema).max(12).default([]),
  certifications: z.array(cvCertificationItemSchema).max(20).default([]),
  languages: z.array(z.string().max(80)).max(20).default([]),
  additionalSections: z
    .array(
      z.object({
        title: shortTextSchema,
        items: z.array(z.string().max(600)).max(20).default([]),
      }),
    )
    .max(10)
    .default([]),
  changeLog: z.array(cvChangeLogEntrySchema).max(40).default([]),
  missingInformation: z.array(cvMissingInformationSchema).max(25).default([]),
  /** Assessment of how ATS-friendly the input CV was, 0-100. */
  atsReadinessScore: z.number().int().min(0).max(100).default(0),
});

export type CvEnhancementDocument = z.infer<typeof cvEnhancementDocumentSchema>;

export const cvEnhancementOptionsSchema = z.object({
  targetCareer: z.string().trim().max(160).optional(),
  targetPosition: z.string().trim().max(160).optional(),
  githubUrl: optionalUrlSchema,
  linkedinUrl: optionalUrlSchema,
  portfolioUrl: optionalUrlSchema,
  /** Free-form additional instruction, kept short and treated as untrusted data. */
  additionalNotes: z.string().trim().max(1000).optional(),
  templateKey: z.enum(CV_TEMPLATE_KEYS).default('ATS_MINIMAL'),
  /**
   * Explicit consent for this request to use the saved profile (name, headline,
   * location, saved links) as framing context. Without it the prompt builder must not
   * include any saved profile data, even when the account has it.
   */
  useProfileContext: z.boolean().default(false),
});

export type CvEnhancementOptions = z.infer<typeof cvEnhancementOptionsSchema>;

export const cvEnhancementRecordSchema = z.object({
  id: z.string(),
  sourceDocumentId: z.string().nullable(),
  status: z.enum(['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'REFUNDED']),
  options: cvEnhancementOptionsSchema,
  document: cvEnhancementDocumentSchema.nullable(),
  templateKey: z.enum(CV_TEMPLATE_KEYS),
  creditsCharged: z.number().int().min(0),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
});

export type CvEnhancementRecord = z.infer<typeof cvEnhancementRecordSchema>;

export const enhanceCvRequestSchema = z.object({
  options: cvEnhancementOptionsSchema.default(() => cvEnhancementOptionsSchema.parse({})),
});

export type EnhanceCvRequest = z.infer<typeof enhanceCvRequestSchema>;

/**
 * `POST /api/cv/enhance` is multipart, so `options` arrives as a JSON string field.
 *
 * Parsing and validating it here keeps the boundary contract in one place: the
 * controller receives exactly the typed object a JSON client would have sent, and a
 * malformed `options` field fails as a validation error rather than a 500.
 */
export const enhanceCvUploadBodySchema = z
  .object({
    options: z.string().trim().max(8_000).optional(),
  })
  .transform((input, ctx) => {
    if (input.options === undefined || input.options === '') {
      return enhanceCvRequestSchema.parse({});
    }

    let json: unknown;
    try {
      json = JSON.parse(input.options);
    } catch {
      ctx.addIssue({
        code: 'custom',
        path: ['options'],
        message: 'options harus berupa JSON yang valid.',
      });
      return z.NEVER;
    }

    // The multipart field carries the *options object itself* (the browser sends
    // `JSON.stringify(options)`), not a `{ options }` wrapper. Validating it against
    // `enhanceCvRequestSchema` silently discarded every field and replaced them with the
    // schema defaults, so targeting, links and the consent flag never reached the prompt.
    const parsed = cvEnhancementOptionsSchema.safeParse(json);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        ctx.addIssue({
          code: 'custom',
          path: ['options', ...issue.path],
          message: issue.message,
        });
      }
      return z.NEVER;
    }

    return { options: parsed.data };
  });

export type EnhanceCvUploadBody = z.infer<typeof enhanceCvUploadBodySchema>;

/**
 * A stored enhancement as the API returns it.
 *
 * `originalText` is the extracted text of the source CV, returned only to its owner so
 * the web client can render the Before vs After comparison without a second upload.
 */
export const cvEnhancementDetailSchema = cvEnhancementRecordSchema.extend({
  originalText: z.string(),
  promptVersion: z.string().min(1).max(64),
});

export type CvEnhancementDetail = z.infer<typeof cvEnhancementDetailSchema>;

export const cvEnhancementResponseSchema = z.object({
  enhancement: cvEnhancementDetailSchema,
});

export type CvEnhancementResponse = z.infer<typeof cvEnhancementResponseSchema>;

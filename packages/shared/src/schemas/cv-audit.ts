import { z } from 'zod';

import { shortTextSchema } from './common.js';

/**
 * The free CV audit result. `atsScore` is the PLATFORM'S analysis metric - it is
 * not a scientifically objective, universal measure, and the UI must say so.
 */
export const KEYWORD_STATUSES = ['PRESENT', 'PARTIAL', 'MISSING'] as const;
export const FORMATTING_STATUSES = ['GOOD', 'WARNING', 'PROBLEM'] as const;
export const SUGGESTION_PRIORITIES = ['HIGH', 'MEDIUM', 'LOW'] as const;

export const keywordAnalysisItemSchema = z.object({
  keyword: shortTextSchema,
  status: z.enum(KEYWORD_STATUSES),
  note: z.string().max(400).default(''),
});

export const formattingAnalysisItemSchema = z.object({
  aspect: shortTextSchema,
  status: z.enum(FORMATTING_STATUSES),
  note: z.string().max(400).default(''),
});

export const improvementSuggestionSchema = z.object({
  title: shortTextSchema,
  detail: z.string().min(1).max(800),
  priority: z.enum(SUGGESTION_PRIORITIES),
});

export const careerFitItemSchema = z.object({
  role: shortTextSchema,
  fit: z.number().int().min(0).max(100),
  reason: z.string().max(600).default(''),
});

/** Exactly what the AI must return. Validated before any business logic reads it. */
export const cvAuditAnalysisSchema = z.object({
  atsScore: z.number().int().min(0).max(100),
  professionalSummary: z.string().min(1).max(2000),
  strengths: z.array(z.string().min(1).max(400)).max(12).default([]),
  weaknesses: z.array(z.string().min(1).max(400)).max(12).default([]),
  missingSections: z.array(z.string().min(1).max(120)).max(15).default([]),
  keywordAnalysis: z.array(keywordAnalysisItemSchema).max(40).default([]),
  formattingAnalysis: z.array(formattingAnalysisItemSchema).max(25).default([]),
  improvementSuggestions: z.array(improvementSuggestionSchema).max(15).default([]),
  careerFit: z.array(careerFitItemSchema).max(8).default([]),
});

export type CvAuditAnalysis = z.infer<typeof cvAuditAnalysisSchema>;

export const cvExtractionMetaSchema = z.object({
  pageCount: z.number().int().min(0),
  charCount: z.number().int().min(0),
  detectedLanguage: z.string().max(16).nullable().default(null),
  fileName: z.string().max(255).nullable().default(null),
});

export type CvExtractionMeta = z.infer<typeof cvExtractionMetaSchema>;

export const cvAuditResultSchema = cvAuditAnalysisSchema.extend({
  extraction: cvExtractionMetaSchema,
  /** Always true for the free guest flow: uploads are not retained. */
  ephemeral: z.boolean().default(true),
  analyzedAt: z.string(),
  provider: z.string(),
  model: z.string(),
  /** Which runtime prompt produced this result; the prompt text itself is never returned. */
  promptVersion: z.string().min(1).max(64),
});

export type CvAuditResult = z.infer<typeof cvAuditResultSchema>;

export const cvAuditResponseSchema = z.object({
  auditId: z.string().nullable(),
  result: cvAuditResultSchema,
});

export type CvAuditResponse = z.infer<typeof cvAuditResponseSchema>;

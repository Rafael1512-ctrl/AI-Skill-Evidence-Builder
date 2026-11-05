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
  /** Retained for historical rows. Current account-backed audits are always false. */
  ephemeral: z.boolean().default(false),
  analyzedAt: z.string(),
  provider: z.string(),
  model: z.string(),
  /** Which runtime prompt produced this result; the prompt text itself is never returned. */
  promptVersion: z.string().min(1).max(64),
});

export type CvAuditResult = z.infer<typeof cvAuditResultSchema>;

export const auditQuotaSchema = z.object({
  freeAuditsLimit: z.number().int().min(1),
  freeAuditsUsed: z.number().int().min(0),
  freeAuditsRemaining: z.number().int().min(0),
  /** End of the current Jakarta calendar day, as an ISO timestamp. */
  resetsAt: z.string(),
  /** Effective, admin-editable price of an audit after the free quota is exhausted. */
  paidAuditCredits: z.number().int().min(0),
});

export const cvAuditUsageSchema = auditQuotaSchema.extend({
  availableCredits: z.number().int().min(0),
});

export type CvAuditUsage = z.infer<typeof cvAuditUsageSchema>;

export const cvAuditBillingSchema = auditQuotaSchema.extend({
  mode: z.enum(['FREE', 'PAID']),
  creditsCharged: z.number().int().min(0),
});

export type CvAuditBilling = z.infer<typeof cvAuditBillingSchema>;

export const cvAuditResponseSchema = z.object({
  auditId: z.string(),
  result: cvAuditResultSchema,
  billing: cvAuditBillingSchema,
});

export type CvAuditResponse = z.infer<typeof cvAuditResponseSchema>;

export const CV_AUDIT_JOB_STATUSES = ['QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED'] as const;

export const cvAuditJobFailureSchema = z.object({
  code: z.string(),
  message: z.string(),
});

export type CvAuditJobFailure = z.infer<typeof cvAuditJobFailureSchema>;

/**
 * Durable state for an asynchronous audit.
 *
 * The result and billing become non-null only after the worker successfully completes the
 * job. A failed job keeps a client-safe code/message so the UI can explain what happened.
 */
export const cvAuditJobSchema = z.object({
  auditId: z.string(),
  status: z.enum(CV_AUDIT_JOB_STATUSES),
  analysisId: z.string().nullable(),
  result: cvAuditResultSchema.nullable(),
  billing: cvAuditBillingSchema.nullable(),
  failure: cvAuditJobFailureSchema.nullable(),
  createdAt: z.string(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
});

export type CvAuditJob = z.infer<typeof cvAuditJobSchema>;

export const cvAuditJobResponseSchema = z.object({
  audit: cvAuditJobSchema,
});

export type CvAuditJobResponse = z.infer<typeof cvAuditJobResponseSchema>;

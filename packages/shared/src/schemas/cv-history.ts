import { z } from 'zod';

import { cvAuditResultSchema } from './cv-audit.js';

const cvHistoryAnalysisKindSchema = z.enum(['FREE_AUDIT', 'DEEP_ANALYSIS']);
const cvHistoryEnhancementStatusSchema = z.enum([
  'PENDING',
  'PROCESSING',
  'COMPLETED',
  'FAILED',
  'REFUNDED',
]);

export const cvHistoryAnalysisSchema = z.object({
  id: z.string(),
  documentId: z.string().nullable(),
  kind: cvHistoryAnalysisKindSchema,
  atsScore: z.number().int().min(0).max(100),
  fileName: z.string().nullable(),
  provider: z.string(),
  model: z.string(),
  createdAt: z.string(),
});

export type CvHistoryAnalysis = z.infer<typeof cvHistoryAnalysisSchema>;

export const cvHistoryEnhancementSchema = z.object({
  id: z.string(),
  sourceDocumentId: z.string().nullable(),
  fileName: z.string().nullable(),
  status: cvHistoryEnhancementStatusSchema,
  templateKey: z.string(),
  creditsCharged: z.number().int().min(0),
  promptVersion: z.string().nullable(),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
});

export type CvHistoryEnhancement = z.infer<typeof cvHistoryEnhancementSchema>;

export const cvHistoryResponseSchema = z.object({
  analyses: z.array(cvHistoryAnalysisSchema),
  enhancements: z.array(cvHistoryEnhancementSchema),
  totals: z.object({
    analyses: z.number().int().min(0),
    enhancements: z.number().int().min(0),
  }),
});

export type CvHistoryResponse = z.infer<typeof cvHistoryResponseSchema>;

/** `GET /cv/analyses/:analysisId`: one stored audit of the signed-in account. */
export const cvAnalysisDetailSchema = z.object({
  id: z.string(),
  kind: cvHistoryAnalysisKindSchema,
  atsScore: z.number().int().min(0).max(100),
  result: cvAuditResultSchema,
  createdAt: z.string(),
});

export type CvAnalysisDetail = z.infer<typeof cvAnalysisDetailSchema>;

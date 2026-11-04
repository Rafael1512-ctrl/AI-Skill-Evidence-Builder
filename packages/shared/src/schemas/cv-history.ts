import { z } from 'zod';

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
  provider: z.string(),
  model: z.string(),
  createdAt: z.string(),
});

export type CvHistoryAnalysis = z.infer<typeof cvHistoryAnalysisSchema>;

export const cvHistoryEnhancementSchema = z.object({
  id: z.string(),
  sourceDocumentId: z.string().nullable(),
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

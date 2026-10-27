import type { Request, Response } from 'express';

import {
  CV_TEMPLATES,
  type CvExportRequest,
  type EnhanceCvRequest,
  type PaginationQuery,
} from '@aseb/shared';

import { currentAuth } from '../middleware/auth.js';
import { validatedBody, validatedParams, validatedQuery } from '../middleware/validate.js';
import { CvRepository } from '../repositories/cv.repository.js';
import { cvAuditService } from '../services/cv-audit.service.js';
import { cvEnhancementService } from '../services/cv-enhancement.service.js';
import { cvExportService } from '../services/cv-export.service.js';
import { AppError } from '../utils/errors.js';

const repository = new CvRepository();

/**
 * Legacy endpoint preserved from the pre-migration prototype
 * (`GET /api/cv/test` in the original routes/cvRoutes.js).
 */
export function testRoute(_req: Request, res: Response): void {
  res.json({
    status: 'success',
    message: 'Jalur API CV berhasil terhubung dengan rapi!',
  });
}

/**
 * POST /api/cv/audit
 *
 * Free for everyone (guests included) and always 0 credits. Anonymous uploads are
 * processed in memory and are not persisted.
 */
export async function auditCv(req: Request, res: Response): Promise<void> {
  const file = req.file;
  if (!file) {
    throw AppError.validation({ field: 'file' }, 'Tidak ada file PDF yang diunggah!');
  }

  const response = await cvAuditService.audit({
    file: {
      originalname: file.originalname,
      mimetype: file.mimetype,
      size: file.size,
      buffer: file.buffer,
    },
    userId: req.auth?.userId ?? null,
  });

  res.status(200).json({ data: response });
}

/** GET /api/cv/templates - the three MVP export templates. */
export function listTemplates(_req: Request, res: Response): void {
  res.json({ data: CV_TEMPLATES });
}

/** GET /api/cv/history - stored audits and enhancements for the signed-in user. */
export async function getHistory(req: Request, res: Response): Promise<void> {
  const auth = currentAuth(req);
  const query = validatedQuery<PaginationQuery>(req);

  const [analyses, enhancements] = await Promise.all([
    repository.listAnalyses(auth.userId, (query.page - 1) * query.pageSize, query.pageSize),
    repository.listEnhancements(auth.userId, (query.page - 1) * query.pageSize, query.pageSize),
  ]);

  res.json({
    data: {
      analyses: analyses.items.map((analysis) => ({
        id: analysis.id,
        kind: analysis.kind,
        atsScore: analysis.atsScore,
        provider: analysis.provider,
        model: analysis.model,
        createdAt: analysis.createdAt.toISOString(),
      })),
      enhancements: enhancements.items.map((enhancement) => ({
        id: enhancement.id,
        status: enhancement.status,
        templateKey: enhancement.templateKey,
        creditsCharged: enhancement.creditsCharged,
        promptVersion: enhancement.promptVersion,
        createdAt: enhancement.createdAt.toISOString(),
        completedAt: enhancement.completedAt?.toISOString() ?? null,
      })),
      totals: { analyses: analyses.total, enhancements: enhancements.total },
    },
    meta: { page: query.page, pageSize: query.pageSize },
  });
}

/**
 * POST /api/cv/enhance
 *
 * Paid (5 credits by default) and therefore authenticated. The service reserves the
 * credits before the model call and settles only when a validated document is stored.
 */
export async function enhanceCv(req: Request, res: Response): Promise<void> {
  const auth = currentAuth(req);
  const file = req.file;
  if (!file) {
    throw AppError.validation({ field: 'file' }, 'Tidak ada file PDF yang diunggah!');
  }

  const body = validatedBody<EnhanceCvRequest>(req);
  const { enhancement } = await cvEnhancementService.enhance({
    userId: auth.userId,
    file: {
      originalname: file.originalname,
      mimetype: file.mimetype,
      size: file.size,
      buffer: file.buffer,
    },
    options: body.options,
  });

  res.status(201).json({ data: { enhancement } });
}

/** GET /api/cv/enhancements/:enhancementId - owner-scoped Before vs After detail. */
export async function getEnhancement(req: Request, res: Response): Promise<void> {
  const auth = currentAuth(req);
  const params = validatedParams<{ enhancementId: string }>(req);

  const enhancement = await cvEnhancementService.getEnhancement(params.enhancementId, auth.userId);
  res.json({ data: { enhancement } });
}

/**
 * POST /api/cv/enhancements/:enhancementId/export
 *
 * Paid (1 credit by default): the PDF renderer runs behind a credit reservation that is
 * settled only when the file is produced and its record is stored.
 */
export async function exportEnhancement(req: Request, res: Response): Promise<void> {
  const auth = currentAuth(req);
  const params = validatedParams<{ enhancementId: string }>(req);
  const body = validatedBody<CvExportRequest>(req);

  const result = await cvExportService.export({
    userId: auth.userId,
    enhancementId: params.enhancementId,
    templateKey: body.templateKey,
  });

  res.status(201).json({ data: { export: result } });
}

/** GET /api/cv/analyses/:analysisId */
export async function getAnalysis(req: Request, res: Response): Promise<void> {
  const auth = currentAuth(req);
  const params = validatedParams<{ analysisId: string }>(req);

  const analysis = await repository.findAnalysis(params.analysisId);
  if (!analysis || analysis.userId !== auth.userId) {
    throw AppError.notFound('Analisis CV tidak ditemukan.');
  }

  res.json({
    data: {
      id: analysis.id,
      kind: analysis.kind,
      atsScore: analysis.atsScore,
      result: analysis.result,
      createdAt: analysis.createdAt.toISOString(),
    },
  });
}

/** DELETE /api/cv/documents/:documentId - user-initiated deletion (privacy). */
export async function deleteDocument(req: Request, res: Response): Promise<void> {
  const auth = currentAuth(req);
  const params = validatedParams<{ documentId: string }>(req);

  await repository.deleteDocument(params.documentId, auth.userId);
  res.status(204).end();
}

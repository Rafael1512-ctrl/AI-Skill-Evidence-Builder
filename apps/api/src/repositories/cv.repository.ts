import type {
  CvAnalysis,
  CvAnalysisKind,
  CvDocument,
  CvDocumentKind,
  CvEnhancement,
  EnhancementStatus,
  Prisma,
} from '../generated/prisma/client.js';
import { getPrisma } from '../db/prisma.js';

export interface CreateDocumentInput {
  userId: string | null;
  kind: CvDocumentKind;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  pageCount: number;
  textContent: string | null;
  textHash: string | null;
  isEphemeral?: boolean;
}

export class CvRepository {
  async createDocument(input: CreateDocumentInput): Promise<CvDocument> {
    return getPrisma().cvDocument.create({
      data: {
        userId: input.userId,
        kind: input.kind,
        fileName: input.fileName,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        pageCount: input.pageCount,
        textContent: input.textContent,
        textHash: input.textHash,
        isEphemeral: input.isEphemeral ?? false,
      },
    });
  }

  async findDocument(id: string): Promise<CvDocument | null> {
    return getPrisma().cvDocument.findFirst({ where: { id, deletedAt: null } });
  }

  async findLatestDocumentForUser(userId: string): Promise<CvDocument | null> {
    return getPrisma().cvDocument.findFirst({
      where: { userId, deletedAt: null, kind: 'ORIGINAL' },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createAnalysis(input: {
    documentId: string | null;
    userId: string | null;
    kind: CvAnalysisKind;
    provider: string;
    model: string;
    promptVersion: string | null;
    atsScore: number;
    result: Prisma.InputJsonValue;
    creditsCharged: number;
  }): Promise<CvAnalysis> {
    return getPrisma().cvAnalysis.create({ data: input });
  }

  async findAnalysis(id: string): Promise<CvAnalysis | null> {
    return getPrisma().cvAnalysis.findUnique({ where: { id } });
  }

  async listAnalyses(
    userId: string,
    skip: number,
    take: number,
  ): Promise<{ items: CvAnalysis[]; total: number }> {
    const prisma = getPrisma();
    const where = { userId };
    const [items, total] = await Promise.all([
      prisma.cvAnalysis.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }),
      prisma.cvAnalysis.count({ where }),
    ]);
    return { items, total };
  }

  async createEnhancement(input: {
    userId: string;
    sourceDocumentId: string | null;
    options: Prisma.InputJsonValue;
    templateKey: string;
    reservationId: string | null;
    promptVersion: string | null;
  }): Promise<CvEnhancement> {
    return getPrisma().cvEnhancement.create({
      data: {
        userId: input.userId,
        sourceDocumentId: input.sourceDocumentId,
        options: input.options,
        templateKey: input.templateKey,
        reservationId: input.reservationId,
        promptVersion: input.promptVersion,
        status: 'PROCESSING',
      },
    });
  }

  async updateEnhancement(
    id: string,
    data: {
      status?: EnhancementStatus;
      document?: Prisma.InputJsonValue | undefined;
      resultDocumentId?: string | null;
      creditsCharged?: number;
      templateKey?: string;
      failureReason?: string | null;
      completedAt?: Date | null;
    },
  ): Promise<CvEnhancement> {
    return getPrisma().cvEnhancement.update({ where: { id }, data });
  }

  async findEnhancement(id: string): Promise<CvEnhancement | null> {
    return getPrisma().cvEnhancement.findUnique({ where: { id } });
  }

  async listEnhancements(
    userId: string,
    skip: number,
    take: number,
  ): Promise<{ items: CvEnhancement[]; total: number }> {
    const prisma = getPrisma();
    const where = { userId };
    const [items, total] = await Promise.all([
      prisma.cvEnhancement.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }),
      prisma.cvEnhancement.count({ where }),
    ]);
    return { items, total };
  }

  async deleteDocument(id: string, userId: string): Promise<void> {
    await getPrisma().cvDocument.updateMany({
      where: { id, userId },
      data: { deletedAt: new Date(), textContent: null },
    });
  }
}

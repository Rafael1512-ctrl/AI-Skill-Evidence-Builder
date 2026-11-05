import type {
  CvAnalysis,
  CvAnalysisKind,
  CvAuditJob,
  CvAuditJobStatus,
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

export type CvAnalysisWithFileName = CvAnalysis & {
  document: Pick<CvDocument, 'fileName'> | null;
};

export type CvAuditJobWithRelations = CvAuditJob & {
  document: Pick<CvDocument, 'fileName' | 'textContent' | 'pageCount'> | null;
  analysis: CvAnalysis | null;
};

export type CvEnhancementWithFileName = CvEnhancement & {
  sourceDocument: Pick<CvDocument, 'fileName'> | null;
};

export type CvEnhancementWithSource = CvEnhancement & {
  sourceDocument: Pick<CvDocument, 'fileName' | 'textContent'> | null;
};

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
    auditJobId?: string | null;
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

  async createAuditJobWithDocument(input: {
    userId: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    pageCount: number;
    textContent: string;
    textHash: string;
    mode: 'FREE' | 'PAID';
    reservationId: string;
    freeAuditsUsed: number;
    paidAuditCredits: number;
    resetsAt: Date;
  }): Promise<{ document: CvDocument; auditJob: CvAuditJob }> {
    return getPrisma().$transaction(async (tx) => {
      const document = await tx.cvDocument.create({
        data: {
          userId: input.userId,
          kind: 'ORIGINAL',
          fileName: input.fileName,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes,
          pageCount: input.pageCount,
          textContent: input.textContent,
          textHash: input.textHash,
        },
      });
      const auditJob = await tx.cvAuditJob.create({
        data: {
          userId: input.userId,
          documentId: document.id,
          mode: input.mode,
          reservationId: input.reservationId,
          freeAuditsUsed: input.freeAuditsUsed,
          paidAuditCredits: input.paidAuditCredits,
          resetsAt: input.resetsAt,
        },
      });
      return { document, auditJob };
    });
  }

  async findAuditJobWithRelations(id: string): Promise<CvAuditJobWithRelations | null> {
    return getPrisma().cvAuditJob.findUnique({
      where: { id },
      include: {
        document: { select: { fileName: true, textContent: true, pageCount: true } },
        analysis: true,
      },
    });
  }

  async findAnalysisForAuditJob(auditJobId: string): Promise<CvAnalysis | null> {
    return getPrisma().cvAnalysis.findUnique({ where: { auditJobId } });
  }

  async updateAuditJob(
    id: string,
    data: {
      status?: CvAuditJobStatus;
      creditsCharged?: number;
      failureCode?: string | null;
      failureReason?: string | null;
      startedAt?: Date | null;
      completedAt?: Date | null;
    },
  ): Promise<CvAuditJob> {
    return getPrisma().cvAuditJob.update({ where: { id }, data });
  }

  async deleteAuditJob(id: string): Promise<void> {
    await getPrisma().cvAuditJob.delete({ where: { id } });
  }

  async findAnalysis(id: string): Promise<CvAnalysis | null> {
    return getPrisma().cvAnalysis.findUnique({ where: { id } });
  }

  async listAnalyses(
    userId: string,
    skip: number,
    take: number,
  ): Promise<{ items: CvAnalysisWithFileName[]; total: number }> {
    const prisma = getPrisma();
    const where = { userId };
    const [items, total] = await Promise.all([
      prisma.cvAnalysis.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: { document: { select: { fileName: true } } },
      }),
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
        status: 'PENDING',
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

  async deleteEnhancement(id: string): Promise<void> {
    await getPrisma().cvEnhancement.delete({ where: { id } });
  }

  /** Reads the source through the relation so a deleted CV still has its file name. */
  async findEnhancementWithSource(id: string): Promise<CvEnhancementWithSource | null> {
    return getPrisma().cvEnhancement.findUnique({
      where: { id },
      include: { sourceDocument: { select: { fileName: true, textContent: true } } },
    });
  }

  async listEnhancements(
    userId: string,
    skip: number,
    take: number,
  ): Promise<{ items: CvEnhancementWithFileName[]; total: number }> {
    const prisma = getPrisma();
    const where = { userId };
    const [items, total] = await Promise.all([
      prisma.cvEnhancement.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: { sourceDocument: { select: { fileName: true } } },
      }),
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

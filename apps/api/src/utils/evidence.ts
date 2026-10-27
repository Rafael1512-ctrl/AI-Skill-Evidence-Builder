import type {
  EvidenceSource,
  ScreeningEvidenceResponse,
  CriterionEvidence,
  EvidenceItem,
} from '@aseb/shared';

import { quoteExistsInSource } from './text.js';

/**
 * Grounding for model-reported evidence.
 *
 * The model is asked for short quotes from the source, but it can paraphrase, merge two
 * sentences, or invent one. A quote that cannot be found in the material we actually hold
 * is dropped, and a `FOUND` verdict that loses every quote is downgraded to `UNCERTAIN` -
 * never the other way round. Absence of evidence stays `NOT_FOUND`, which says nothing
 * about the candidate's honesty (docs/AI_PROMPTS.md §11).
 */

export interface EvidenceSourceDocument {
  readonly source: EvidenceSource;
  readonly text: string;
}

export interface GroundingSummary {
  /** Quotes removed because they could not be found in the source we hold. */
  readonly droppedQuotes: number;
  /** Criteria downgraded from `FOUND` to `UNCERTAIN` because nothing was verifiable. */
  readonly downgradedCriteria: number;
  /**
   * Page numbers could not be verified: Phase 11 stores the joined CV text without its
   * per-page breakdown, so a model-supplied page would be an unverifiable citation.
   */
  readonly pageVerification: 'unavailable';
}

export interface GroundedEvidence {
  readonly data: ScreeningEvidenceResponse;
  readonly summary: GroundingSummary;
}

const UNVERIFIED_QUOTE_NOTE =
  'Kutipan dari model tidak ditemukan pada sumber yang tersedia, sehingga tidak disimpan.';
const DOWNGRADE_NOTE =
  'Tidak ada kutipan bukti yang dapat diverifikasi pada sumber, sehingga status diturunkan menjadi UNCERTAIN.';

function withNote(existing: string, note: string): string {
  const trimmed = existing.trim();
  if (trimmed.length === 0) return note;
  // Keep within the schema's 600-char budget.
  return `${trimmed.slice(0, 400)} ${note}`.slice(0, 600);
}

function groundCriterion(
  criterion: CriterionEvidence,
  sources: ReadonlyMap<EvidenceSource, string>,
): { criterion: CriterionEvidence; dropped: number; downgraded: boolean } {
  // `NOT_FOUND` means "no supporting evidence exists": a quote here would contradict the
  // status, so none is kept.
  if (criterion.status === 'NOT_FOUND') {
    const dropped = criterion.evidence.length;
    return {
      criterion: {
        ...criterion,
        evidence: [],
        notes: dropped > 0 ? withNote(criterion.notes, UNVERIFIED_QUOTE_NOTE) : criterion.notes,
      },
      dropped,
      downgraded: false,
    };
  }

  const verified: EvidenceItem[] = [];
  let dropped = 0;

  for (const item of criterion.evidence) {
    const source = sources.get(item.source);
    if (!source || !quoteExistsInSource(item.quote, source)) {
      dropped += 1;
      continue;
    }
    verified.push({ ...item, page: null });
  }

  if (criterion.status === 'FOUND' && verified.length === 0) {
    return {
      criterion: {
        ...criterion,
        status: 'UNCERTAIN',
        evidence: [],
        notes: withNote(criterion.notes, DOWNGRADE_NOTE),
      },
      dropped,
      downgraded: true,
    };
  }

  return {
    criterion: {
      ...criterion,
      evidence: verified,
      notes: dropped > 0 ? withNote(criterion.notes, UNVERIFIED_QUOTE_NOTE) : criterion.notes,
    },
    dropped,
    downgraded: false,
  };
}

export function groundScreeningEvidence(
  response: ScreeningEvidenceResponse,
  documents: readonly EvidenceSourceDocument[],
): GroundedEvidence {
  const sources = new Map<EvidenceSource, string>();
  for (const document of documents) {
    if (document.text.trim().length > 0) sources.set(document.source, document.text);
  }

  let droppedQuotes = 0;
  let downgradedCriteria = 0;

  const criteria = response.criteria.map((criterion) => {
    const grounded = groundCriterion(criterion, sources);
    droppedQuotes += grounded.dropped;
    if (grounded.downgraded) downgradedCriteria += 1;
    return grounded.criterion;
  });

  return {
    data: { ...response, criteria },
    summary: { droppedQuotes, downgradedCriteria, pageVerification: 'unavailable' },
  };
}

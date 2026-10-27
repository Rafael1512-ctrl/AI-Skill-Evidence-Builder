import { createHash } from 'node:crypto';

/**
 * Stable hex digest for audit trails.
 *
 * Used where a stored record must prove *which* content it was built from (extracted CV
 * text, rendered bytes) without keeping a second copy of that content.
 */
export function sha256Hex(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}

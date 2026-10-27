/**
 * Text hygiene helpers.
 *
 * CV text, ZIP entry names and fetched web pages are all UNTRUSTED DATA. Nothing in
 * this module executes or interprets their content - it only normalises and bounds it.
 */

// eslint-disable-next-line no-control-regex -- stripping control characters is the point
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u2028\u2029]/g;
const ZERO_WIDTH = /[\uFEFF\u2060]/g;

/** Removes control characters and collapses runaway whitespace. */
export function sanitizeText(input: string): string {
  return input
    .replace(/\r\n?/g, '\n')
    .replace(CONTROL_CHARS, '')
    .replace(ZERO_WIDTH, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Character budget sent to the model. Keeps prompts predictable and cost bounded. */
export const MAX_CV_PROMPT_CHARS = 30_000;

export function truncate(input: string, maxChars: number): { text: string; truncated: boolean } {
  if (input.length <= maxChars) return { text: input, truncated: false };
  return { text: input.slice(0, maxChars), truncated: true };
}

/**
 * Wraps untrusted content in explicit delimiters so the model can tell data from
 * instructions. The system prompt states that everything inside is data only.
 */
export function wrapUntrusted(label: string, content: string): string {
  const safeLabel = label.replace(/[^a-zA-Z0-9 _-]/g, '').slice(0, 40) || 'document';
  return [`<untrusted_document name="${safeLabel}">`, content, '</untrusted_document>'].join('\n');
}

/** Number of words, used for cheap text-quality heuristics. */
export function wordCount(input: string): number {
  const matches = input.trim().match(/\S+/g);
  return matches ? matches.length : 0;
}

/**
 * Extracts the first JSON object from a model response.
 *
 * Models occasionally wrap JSON in prose or fenced code blocks. This performs a
 * structural scan rather than a blind `JSON.parse`, and never evaluates code.
 */
export function extractJsonObject(raw: string): unknown {
  const withoutFences = raw
    .replace(/^\s*```(?:json)?/gim, '')
    .replace(/```\s*$/gim, '')
    .trim();

  try {
    return JSON.parse(withoutFences);
  } catch {
    // fall through to balanced-brace scan
  }

  const start = withoutFences.indexOf('{');
  if (start === -1) return undefined;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < withoutFences.length; index += 1) {
    const char = withoutFences[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        const candidate = withoutFences.slice(start, index + 1);
        try {
          return JSON.parse(candidate);
        } catch {
          return undefined;
        }
      }
    }
  }

  return undefined;
}

/** Case-insensitive search that ignores extra whitespace: used for evidence quoting. */
export function normaliseForMatch(input: string): string {
  return input.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Confirms an evidence quote really appears in the source document.
 *
 * Anti-fabrication guard: a model-reported quote that cannot be found in the CV is
 * downgraded rather than trusted.
 */
export function quoteExistsInSource(quote: string, source: string): boolean {
  const needle = normaliseForMatch(quote);
  if (needle.length < 4) return false;
  return normaliseForMatch(source).includes(needle);
}

export function safeFileName(input: string): string {
  return (
    input
      .replace(/[\\/]/g, '_')
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .replace(/_{2,}/g, '_')
      .slice(0, 120) || 'file'
  );
}

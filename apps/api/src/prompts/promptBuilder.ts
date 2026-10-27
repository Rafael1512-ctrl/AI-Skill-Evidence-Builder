import { MAX_CV_PROMPT_CHARS, sanitizeText, truncate, wrapUntrusted } from '../utils/text.js';

import { GLOBAL_AI_RULES, JSON_ONLY_INSTRUCTION, LANGUAGE_POLICY } from './global/globalPolicy.js';
import type { PromptMessage, PromptPayload, PromptVersionId } from './types.js';

export interface StructuredBlock {
  readonly label: string;
  readonly value: unknown;
}

export interface UntrustedDocument {
  readonly name: string;
  readonly content: string;
}

export interface BuildPromptInput {
  readonly version: PromptVersionId;
  readonly temperature: number;
  /** Layer 2: the feature's own role, task, non-goals and output schema. */
  readonly featurePrompt: string;
  /** Additional layer-1 policy modules, in order. */
  readonly policyBlocks?: readonly string[];
  /** Layer 3: trusted context the application supplies about the user or recruiter. */
  readonly context?: readonly StructuredBlock[];
  /** Layer 4: parameters for this specific call. */
  readonly task: readonly StructuredBlock[];
  /** Layer 5: untrusted documents. Always emitted last. */
  readonly documents?: readonly UntrustedDocument[];
}

export function composeSystemPrompt(...blocks: Array<string | undefined>): string {
  return blocks
    .filter((block): block is string => typeof block === 'string' && block.length > 0)
    .join('\n\n');
}

function renderBlock(kind: 'KONTEKS' | 'TUGAS', block: StructuredBlock): string {
  return [`[${kind}: ${block.label}]`, JSON.stringify(block.value, null, 2)].join('\n');
}

/**
 * Composes a runtime prompt from the standard layers.
 *
 * Trusted material (global policy, feature instructions, app-supplied context and task
 * parameters) always precedes untrusted documents, and untrusted documents are always
 * delimited, so no document can appear to continue an instruction.
 */
export function buildPrompt(input: BuildPromptInput): PromptPayload {
  const system = composeSystemPrompt(
    GLOBAL_AI_RULES,
    ...(input.policyBlocks ?? []),
    input.featurePrompt,
    LANGUAGE_POLICY,
    JSON_ONLY_INSTRUCTION,
  );

  const parts: string[] = [];
  for (const block of input.context ?? []) parts.push(renderBlock('KONTEKS', block));
  for (const block of input.task) parts.push(renderBlock('TUGAS', block));
  for (const document of input.documents ?? []) {
    const bounded = truncate(sanitizeText(document.content), MAX_CV_PROMPT_CHARS);
    parts.push(wrapUntrusted(document.name, bounded.text));
  }

  const messages: PromptMessage[] = [
    { role: 'system', content: system },
    { role: 'user', content: parts.join('\n\n') },
  ];

  return { version: input.version, messages, temperature: input.temperature };
}

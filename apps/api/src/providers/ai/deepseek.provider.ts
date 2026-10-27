import OpenAI from 'openai';
import type { ZodType } from 'zod';

import {
  cvAuditAnalysisSchema,
  cvEnhancementDocumentSchema,
  portfolioSummaryResponseSchema,
  screeningEvidenceResponseSchema,
  type CvAuditAnalysis,
  type CvEnhancementDocument,
  type ScreeningEvidenceResponse,
} from '@aseb/shared';

import {
  computeUsageCost,
  resolveProviderPricing,
  type ProviderPricingConfig,
} from '../../config/ai-pricing.js';
import { AppError } from '../../utils/errors.js';
import { extractJsonObject } from '../../utils/text.js';
import type { PromptPayload } from '../../prompts/types.js';
import type {
  AiCallResult,
  AiUsage,
  AIProvider,
  CvAuditInput,
  CvEnhancementInput,
  PortfolioAnalysisInput,
  PortfolioSummary,
  ScreeningEvidenceInput,
} from './types.js';

export interface DeepSeekProviderConfig {
  apiKey: string;
  baseUrl: string;
  /** Model ids are configuration, never hardcoded: a provider rename must not break us. */
  model: string;
  fallbackModels: string[];
  timeoutMs: number;
  maxRetries?: number;
  markupMultiplier?: number;
  pricing?: ProviderPricingConfig;
}

const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 800;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitter(ms: number): number {
  return ms / 2 + Math.random() * (ms / 2);
}

function statusOf(error: unknown): number | undefined {
  if (typeof error === 'object' && error !== null && 'status' in error) {
    const status = (error as { status?: unknown }).status;
    if (typeof status === 'number') return status;
  }
  return undefined;
}

function isRetryable(error: unknown): boolean {
  const status = statusOf(error);
  if (status === 429) return true;
  if (status !== undefined && status >= 500) return true;
  return error instanceof Error && /timeout|ETIMEDOUT|ECONNRESET|fetch failed/i.test(error.message);
}

/**
 * DeepSeek implementation, using the OpenAI-compatible SDK.
 *
 * The model id and base URL come from environment configuration. Output is always
 * validated with Zod before it reaches business logic, and transient failures are
 * retried with exponential backoff plus jitter.
 */
export class DeepSeekProvider implements AIProvider {
  readonly name = 'deepseek';

  private readonly client: OpenAI;
  private readonly config: DeepSeekProviderConfig;

  constructor(config: DeepSeekProviderConfig) {
    if (!config.apiKey) {
      throw AppError.aiProvider(
        'DEEPSEEK_API_KEY belum dikonfigurasi. Set AI_PROVIDER=mock untuk pengembangan offline.',
      );
    }
    if (!config.model) {
      throw AppError.aiProvider(
        'DEEPSEEK_MODEL belum dikonfigurasi. Model id harus berasal dari environment, bukan ditulis di kode.',
      );
    }

    this.config = config;
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
      timeout: config.timeoutMs,
      maxRetries: 0, // retries are handled here so backoff, jitter and usage stay observable
    });
  }

  get model(): string {
    return this.config.model;
  }

  private usageOf(usage: OpenAI.CompletionUsage | undefined, model: string): AiUsage {
    const inputTokens = usage?.prompt_tokens ?? 0;
    const outputTokens = usage?.completion_tokens ?? 0;
    const cached = usage?.prompt_tokens_details?.cached_tokens ?? 0;

    if (usage === undefined) {
      return {
        inputTokens: 0,
        outputTokens: 0,
        cachedTokens: 0,
        requestCount: 1,
        estimatedCostUsd: null,
        targetRevenueUsd: null,
        pricingKnown: false,
      };
    }

    const cost = computeUsageCost(
      { provider: this.name, model, inputTokens, outputTokens, cachedTokens: cached },
      {
        ...(this.config.pricing ? { pricing: this.config.pricing } : {}),
        markupMultiplier: this.config.markupMultiplier ?? 2,
      },
    );

    return {
      inputTokens,
      outputTokens,
      cachedTokens: cached,
      requestCount: 1,
      estimatedCostUsd: cost.estimatedCostUsd,
      targetRevenueUsd: cost.targetRevenueUsd,
      pricingKnown: cost.pricingKnown,
    };
  }

  private async callJson<T>(input: {
    prompt: PromptPayload;
    schema: ZodType<T>;
    signal?: AbortSignal | undefined;
    label: string;
  }): Promise<AiCallResult<T>> {
    const models = [this.config.model, ...this.config.fallbackModels];
    let lastError: unknown;

    for (const model of models) {
      try {
        return await this.attemptModel(model, input);
      } catch (error) {
        lastError = error;
        // A malformed answer or a hard failure on the primary model may still work on a
        // fallback model; rate limits are retried inside attemptModel already.
        if (!this.shouldTryFallback(error)) throw error;
      }
    }

    throw lastError instanceof AppError
      ? lastError
      : AppError.aiProvider(`Semua model AI gagal dipanggil (${input.label}).`, lastError);
  }

  private shouldTryFallback(error: unknown): boolean {
    if (error instanceof AppError) {
      return error.code === 'AI_INVALID_RESPONSE' || error.code === 'AI_PROVIDER_ERROR';
    }
    return false;
  }

  private async attemptModel<T>(
    model: string,
    input: {
      prompt: PromptPayload;
      schema: ZodType<T>;
      signal?: AbortSignal | undefined;
      label: string;
    },
  ): Promise<AiCallResult<T>> {
    const startedAt = Date.now();
    const maxAttempts = this.config.maxRetries ?? MAX_ATTEMPTS;
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const response = await this.client.chat.completions.create(
          {
            model,
            messages: input.prompt.messages.map((message) => ({
              role: message.role,
              content: message.content,
            })),
            temperature: input.prompt.temperature,
            response_format: { type: 'json_object' },
          },
          input.signal ? { signal: input.signal } : {},
        );

        const raw = response.choices[0]?.message?.content ?? '';
        const parsedJson = extractJsonObject(raw);
        const validated = input.schema.safeParse(parsedJson);

        if (!validated.success) {
          lastError = AppError.aiInvalidResponse({
            label: input.label,
            issues: validated.error.issues.slice(0, 5).map((issue) => ({
              path: issue.path.join('.'),
              message: issue.message,
            })),
          });
          if (attempt < maxAttempts) {
            await sleep(jitter(BASE_BACKOFF_MS * attempt));
            continue;
          }
          throw lastError;
        }

        return {
          data: validated.data,
          usage: this.usageOf(response.usage, model),
          provider: this.name,
          model,
          promptVersion: input.prompt.version,
          latencyMs: Date.now() - startedAt,
        };
      } catch (error) {
        if (error instanceof AppError) {
          if (
            (error.code === 'AI_INVALID_RESPONSE' || error.code === 'AI_RATE_LIMITED') &&
            attempt < maxAttempts
          ) {
            await sleep(jitter(BASE_BACKOFF_MS * attempt));
            continue;
          }
          throw error;
        }

        const status = statusOf(error);
        if (status === 429) {
          lastError = AppError.aiRateLimited(error);
          if (attempt < maxAttempts) {
            await sleep(jitter(BASE_BACKOFF_MS * attempt));
            continue;
          }
          throw lastError;
        }

        if (isRetryable(error) && attempt < maxAttempts) {
          lastError = error;
          await sleep(jitter(BASE_BACKOFF_MS * attempt));
          continue;
        }

        throw AppError.aiProvider(
          `Gagal memanggil penyedia AI (${input.label}${status ? `, status ${status}` : ''}).`,
          error,
        );
      }
    }

    throw lastError instanceof AppError
      ? lastError
      : AppError.aiProvider(
          `Panggilan AI gagal setelah ${maxAttempts} percobaan (${input.label}).`,
          lastError,
        );
  }

  async analyzeCv(input: CvAuditInput): Promise<AiCallResult<CvAuditAnalysis>> {
    return this.callJson({
      prompt: input.prompt,
      schema: cvAuditAnalysisSchema,
      signal: input.signal,
      label: 'analisis-cv',
    });
  }

  async enhanceCv(input: CvEnhancementInput): Promise<AiCallResult<CvEnhancementDocument>> {
    return this.callJson({
      prompt: input.prompt,
      schema: cvEnhancementDocumentSchema,
      signal: input.signal,
      label: 'penyempurnaan-cv',
    });
  }

  /** Composed by `prompts/hrd/evidenceExtractionPrompt.ts`; the provider only transports it. */
  async extractScreeningEvidence(
    input: ScreeningEvidenceInput,
  ): Promise<AiCallResult<ScreeningEvidenceResponse>> {
    return this.callJson({
      prompt: input.prompt,
      schema: screeningEvidenceResponseSchema,
      signal: input.signal,
      label: 'ekstraksi-bukti',
    });
  }

  /** Composed by `prompts/hrd/portfolioVerificationPrompt.ts`; the provider only transports it. */
  async analyzePortfolio(input: PortfolioAnalysisInput): Promise<AiCallResult<PortfolioSummary>> {
    const result = await this.callJson({
      prompt: input.prompt,
      schema: portfolioSummaryResponseSchema,
      signal: input.signal,
      label: 'portofolio',
    });

    return {
      ...result,
      data: {
        reachable: !result.data.inconclusive,
        title: result.data.title,
        summary: result.data.summary,
        apparentSkills: result.data.apparentSkills,
        projectHints: result.data.projectHints,
        inconclusive: result.data.inconclusive,
      },
    };
  }
}

export function createDeepSeekProvider(config: {
  apiKey: string | undefined;
  baseUrl: string;
  model: string | undefined;
  fallbackModels: string[];
  timeoutMs: number;
  markupMultiplier: number;
  pricingOverrideJson?: string | undefined;
}): DeepSeekProvider {
  return new DeepSeekProvider({
    apiKey: config.apiKey ?? '',
    baseUrl: config.baseUrl,
    model: config.model ?? '',
    fallbackModels: config.fallbackModels,
    timeoutMs: config.timeoutMs,
    markupMultiplier: config.markupMultiplier,
    pricing: resolveProviderPricing(config.pricingOverrideJson),
  });
}

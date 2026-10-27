import type { ZodType } from 'zod';

import { apiErrorBodySchema, apiSuccessBodySchema } from '@aseb/shared';

/** Empty by default: the Vite dev server proxies `/api` so requests stay same-origin. */
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: unknown;

  constructor(code: string, message: string, status: number, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }
}

export interface ApiRequestOptions<T> {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  token?: string | null;
  /** Validates the payload before it reaches application code. */
  schema: ZodType<T>;
  signal?: AbortSignal;
}

export interface ApiUploadOptions<T> {
  file: File;
  /** Multipart field name; the API expects `file` for CV uploads. */
  fieldName?: string;
  /** Extra multipart text fields (e.g. a JSON `options` blob), appended before the file. */
  fields?: Record<string, string>;
  token?: string | null;
  schema: ZodType<T>;
  signal?: AbortSignal;
}

/**
 * Unwraps the `{ data }` envelope and validates it against the caller's contract.
 *
 * Shared by the JSON and multipart paths so both surfaces fail identically when the API
 * contract drifts.
 */
async function parseResponse<T>(response: Response, schema: ZodType<T>): Promise<T> {
  const raw: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const parsed = apiErrorBodySchema.safeParse(raw);
    if (parsed.success) {
      throw new ApiError(
        parsed.data.error.code,
        parsed.data.error.message,
        response.status,
        parsed.data.error.details,
      );
    }
    throw new ApiError('UNKNOWN_ERROR', 'Terjadi kesalahan pada server.', response.status);
  }

  const envelope = apiSuccessBodySchema.safeParse(raw);
  if (!envelope.success) {
    throw new ApiError('INVALID_RESPONSE', 'Respons server tidak dikenali.', response.status);
  }

  const parsed = schema.safeParse(envelope.data.data);
  if (!parsed.success) {
    throw new ApiError('INVALID_RESPONSE', 'Respons server tidak sesuai kontrak.', response.status);
  }
  return parsed.data;
}

/**
 * The single HTTP entry point for the web app.
 *
 * Every response is parsed through Zod: the API envelope first, then the caller's
 * contract, so a contract drift surfaces as a typed error instead of a broken screen.
 */
export async function apiRequest<T>(path: string, options: ApiRequestOptions<T>): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (options.token) headers.authorization = `Bearer ${options.token}`;

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method ?? 'GET',
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    ...(options.signal ? { signal: options.signal } : {}),
  });

  return parseResponse(response, options.schema);
}

export interface ApiUploadManyOptions<T> {
  files: readonly File[];
  /** Multipart field name every file is appended under (the batch API expects `files`). */
  fieldName?: string;
  token?: string | null;
  schema: ZodType<T>;
  signal?: AbortSignal;
}

/**
 * Multi-file sibling of `apiUpload`, for the screening batch.
 *
 * Every file shares one field name because the API reads them as a set: a batch is either a
 * list of PDFs or a single ZIP, and the server decides which from the content rather than
 * from the client's field naming.
 */
export async function apiUploadMany<T>(path: string, options: ApiUploadManyOptions<T>): Promise<T> {
  const form = new FormData();
  for (const file of options.files) form.append(options.fieldName ?? 'files', file);

  const headers: Record<string, string> = {};
  if (options.token) headers.authorization = `Bearer ${options.token}`;

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers,
    body: form,
    ...(options.signal ? { signal: options.signal } : {}),
  });

  return parseResponse(response, options.schema);
}

/**
 * `multipart/form-data` sibling of `apiRequest`.
 *
 * The browser sets the boundary header, so `content-type` is deliberately not set here.
 */
export async function apiUpload<T>(path: string, options: ApiUploadOptions<T>): Promise<T> {
  const form = new FormData();
  for (const [key, value] of Object.entries(options.fields ?? {})) form.append(key, value);
  form.append(options.fieldName ?? 'file', options.file);

  const headers: Record<string, string> = {};
  if (options.token) headers.authorization = `Bearer ${options.token}`;

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers,
    body: form,
    ...(options.signal ? { signal: options.signal } : {}),
  });

  return parseResponse(response, options.schema);
}

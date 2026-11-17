/**
 * Provider-agnostic AI access for Edge Functions.
 *
 * - Primary: Google Gemini (model id from GEMINI_MODEL), fallback: Groq OpenAI-compatible
 *   endpoint (model id from GROQ_MODEL). Model ids are never hardcoded.
 * - Retries the same provider with exponential backoff on 429 / 5xx / timeout, then falls
 *   back to the next provider. Audio requests only go to providers that support audio.
 * - No environment access here: callers pass keys/models in, so this file also runs in Jest.
 * - Never logs prompt or response content (privacy mode audits rely on this).
 */
import type { z } from 'zod';

export interface AIRequest {
  system: string;
  user: string;
  /** Inline audio (base64) for transcription; only providers with `supportsAudio`. */
  audio?: { mimeType: string; base64: string };
  temperature?: number;
  maxOutputTokens?: number;
}

export interface AIResponse {
  text: string;
  provider: string;
  model: string;
}

export interface AIProvider {
  readonly name: string;
  readonly model: string;
  readonly supportsAudio: boolean;
  generateJson(req: AIRequest, signal: AbortSignal): Promise<AIResponse>;
}

export class AIError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly retryable: boolean,
    readonly provider: string,
  ) {
    super(message);
    this.name = 'AIError';
  }
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 408 || status >= 500;
}

type FetchFn = typeof fetch;

export class GeminiProvider implements AIProvider {
  readonly name = 'gemini';
  readonly supportsAudio = true;
  constructor(
    private readonly apiKey: string,
    readonly model: string,
    private readonly fetchFn: FetchFn = fetch,
    /** Override for API gateways / regional proxies (GEMINI_BASE_URL). */
    private readonly baseUrl = 'https://generativelanguage.googleapis.com',
  ) {}

  async generateJson(req: AIRequest, signal: AbortSignal): Promise<AIResponse> {
    const url = `${this.baseUrl}/v1beta/models/${encodeURIComponent(this.model)}:generateContent`;
    const parts: unknown[] = [{ text: req.user }];
    if (req.audio) parts.push({ inline_data: { mime_type: req.audio.mimeType, data: req.audio.base64 } });
    const res = await this.fetchFn(url, {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.apiKey },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: req.system }] },
        contents: [{ role: 'user', parts }],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: req.temperature ?? 0.2,
          maxOutputTokens: req.maxOutputTokens ?? 2048,
        },
      }),
    });
    if (!res.ok) {
      throw new AIError(`gemini HTTP ${res.status}`, res.status, isRetryableStatus(res.status), this.name);
    }
    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
    };
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
    if (!text) throw new AIError('gemini empty response', null, true, this.name);
    return { text, provider: this.name, model: this.model };
  }
}

export class GroqProvider implements AIProvider {
  readonly name = 'groq';
  readonly supportsAudio = false;
  constructor(
    private readonly apiKey: string,
    readonly model: string,
    private readonly fetchFn: FetchFn = fetch,
    /** Override for API gateways (GROQ_BASE_URL). */
    private readonly baseUrl = 'https://api.groq.com',
  ) {}

  async generateJson(req: AIRequest, signal: AbortSignal): Promise<AIResponse> {
    if (req.audio) throw new AIError('groq: audio not supported', null, false, this.name);
    const res = await this.fetchFn(`${this.baseUrl}/openai/v1/chat/completions`, {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: this.model,
        temperature: req.temperature ?? 0.2,
        max_tokens: req.maxOutputTokens ?? 2048,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: req.system },
          { role: 'user', content: req.user },
        ],
      }),
    });
    if (!res.ok) {
      throw new AIError(`groq HTTP ${res.status}`, res.status, isRetryableStatus(res.status), this.name);
    }
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = data.choices?.[0]?.message?.content ?? '';
    if (!text) throw new AIError('groq empty response', null, true, this.name);
    return { text, provider: this.name, model: this.model };
  }
}

export interface CallOptions {
  timeoutMs?: number;
  /** Retries per provider for retryable errors (default 1). */
  retries?: number;
  baseDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  log?: (event: Record<string, unknown>) => void;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Try providers in order with backoff; return the first success. */
export async function callWithFallback(providers: readonly AIProvider[], req: AIRequest, opts: CallOptions = {}): Promise<AIResponse> {
  const timeoutMs = opts.timeoutMs ?? 20_000;
  const retries = opts.retries ?? 1;
  const base = opts.baseDelayMs ?? 600;
  const sleep = opts.sleep ?? defaultSleep;
  const usable = providers.filter((p) => !req.audio || p.supportsAudio);
  if (usable.length === 0) throw new AIError('no AI provider configured', null, false, 'none');

  let lastError: unknown = null;
  for (const provider of usable) {
    for (let attempt = 0; attempt <= retries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const started = Date.now();
      try {
        const res = await provider.generateJson(req, controller.signal);
        opts.log?.({ event: 'ai_ok', provider: provider.name, attempt, ms: Date.now() - started });
        return res;
      } catch (e) {
        const aborted = controller.signal.aborted;
        const err =
          e instanceof AIError
            ? e
            : new AIError(aborted ? `${provider.name} timeout` : `${provider.name} network error`, null, true, provider.name);
        lastError = err;
        opts.log?.({ event: 'ai_error', provider: provider.name, attempt, status: err.status, retryable: err.retryable });
        if (!err.retryable) break; // try next provider
        if (attempt < retries) await sleep(base * 2 ** attempt + Math.floor(Math.random() * 100));
      } finally {
        clearTimeout(timer);
      }
    }
  }
  throw lastError instanceof AIError ? lastError : new AIError('all AI providers failed', null, true, 'all');
}

export class SchemaError extends Error {
  constructor(readonly issues: string) {
    super('AI response did not match schema');
    this.name = 'SchemaError';
  }
}

/** Strip ```json fences some models add despite JSON mode. */
export function extractJson(text: string): unknown {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '');
  return JSON.parse(trimmed);
}

/**
 * Call AI and validate with Zod. On schema failure retry once, telling the model what was
 * wrong; a second failure throws SchemaError (caller falls back).
 */
export async function generateStructured<T>(
  providers: readonly AIProvider[],
  schema: z.ZodType<T>,
  req: AIRequest,
  opts: CallOptions = {},
): Promise<{ data: T; provider: string; model: string }> {
  let request = req;
  let issues = '';
  for (let i = 0; i < 2; i++) {
    const res = await callWithFallback(providers, request, opts);
    let parsed: unknown;
    try {
      parsed = extractJson(res.text);
    } catch {
      issues = 'Response was not valid JSON.';
      request = { ...req, user: `${req.user}\n\nYour previous answer was invalid: ${issues} Return ONLY the JSON object.` };
      continue;
    }
    const result = schema.safeParse(parsed);
    if (result.success) return { data: result.data, provider: res.provider, model: res.model };
    issues = result.error.issues
      .slice(0, 5)
      .map((x) => `${x.path.join('.')}: ${x.message}`)
      .join('; ');
    opts.log?.({ event: 'ai_schema_error', provider: res.provider, attempt: i });
    request = {
      ...req,
      user: `${req.user}\n\nYour previous answer did not match the schema (${issues}). Return ONLY a corrected JSON object.`,
    };
  }
  throw new SchemaError(issues);
}

import { Logger } from '@nestjs/common';
import { loadConfig } from '../config';

const logger = new Logger('LLM');

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: any;
  tool_calls?: any[];
  tool_call_id?: string;
}

export function llmConfigured(): boolean {
  return Boolean(loadConfig().openai.apiKey);
}

/**
 * Minimal client for the OpenAI-compatible Chat Completions endpoint.
 * Returns null (never throws) when the provider is not configured or the call fails, so
 * callers can fall back to the deterministic implementation.
 */
export async function chatCompletion(
  messages: ChatMessage[],
  opts: { tools?: any[]; jsonObject?: boolean; maxTokens?: number } = {},
): Promise<{ message: ChatMessage } | null> {
  const cfg = loadConfig().openai;
  if (!cfg.apiKey) return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45_000);
    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({
        model: cfg.model,
        messages,
        temperature: 0.1,
        ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
        ...(opts.tools?.length ? { tools: opts.tools, tool_choice: 'auto' } : {}),
        ...(opts.jsonObject ? { response_format: { type: 'json_object' } } : {}),
      }),
    });
    clearTimeout(timer);
    if (!res.ok) {
      logger.warn(`LLM request failed with HTTP ${res.status}`);
      return null;
    }
    const data: any = await res.json();
    const message = data?.choices?.[0]?.message;
    return message ? { message } : null;
  } catch (err) {
    logger.warn(`LLM request failed: ${(err as Error).message}`);
    return null;
  }
}

/** Ask a vision-capable model to transcribe an image. Returns null when unavailable. */
export async function transcribeImage(image: Buffer, mimeType: string): Promise<string | null> {
  const res = await chatCompletion(
    [
      {
        role: 'system',
        content:
          'You transcribe documents. Return only the text that is visibly present in the image, line by line. Do not add, infer or summarise anything. If no text is legible, return an empty string.',
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Transcribe this document.' },
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${image.toString('base64')}` } },
        ],
      },
    ],
    { maxTokens: 2000 },
  );
  const text = res?.message?.content;
  return typeof text === 'string' ? text : null;
}

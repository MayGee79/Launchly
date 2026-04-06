import crypto from 'node:crypto';
import { z } from 'zod';

function normalize(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function hashKey(input) {
  return crypto.createHash('sha256').update(String(input || '')).digest('hex').slice(0, 24);
}

const OpenAIEmbeddingsResponseSchema = z.object({
  data: z
    .array(
      z.object({
        embedding: z.array(z.number()),
      })
    )
    .min(1),
});

export async function embedText({ provider, apiKey, model, text }) {
  const t = normalize(text);
  if (!t) throw new Error('text is required');

  if (provider === 'openai') {
    if (!apiKey) throw new Error('OPENAI_API_KEY is required');
    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: model || 'text-embedding-3-small',
        input: t,
      }),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`Embeddings HTTP ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
    const parsed = OpenAIEmbeddingsResponseSchema.parse(json);
    return parsed.data[0].embedding;
  }

  throw new Error(`Unsupported embedding provider: ${provider}`);
}

export function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || !a.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i];
    const y = b[i];
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom ? dot / denom : 0;
}

export function makeEmbeddingId({ connector, sourceId }) {
  return `${connector}:${hashKey(sourceId)}`;
}


function requiredEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name}`);
  return v;
}

export function llmEnabled() {
  return Boolean(process.env.OPENAI_API_KEY);
}

export async function chatComplete({ system, user, maxTokens = 400 } = {}) {
  const apiKey = requiredEnv('OPENAI_API_KEY');
  const model = process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini';
  const messages = [];
  if (system) messages.push({ role: 'system', content: String(system) });
  messages.push({ role: 'user', content: String(user || '') });

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.2,
      max_tokens: maxTokens,
    }),
  });

  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = json?.error?.message || `OpenAI chat failed (${res.status})`;
    throw new Error(msg);
  }

  return String(json?.choices?.[0]?.message?.content || '').trim();
}

export function createLlmClient(env = process.env, cfg = {}) {
  const enabled = (cfg.enabled ?? true) && Boolean(env.OPENAI_API_KEY);
  const maxTokens = Number.isFinite(cfg.maxTokens) ? cfg.maxTokens : 700;

  return {
    enabled,
    async chat({ system, user }) {
      if (!enabled) throw new Error('LLM disabled (missing OPENAI_API_KEY or config)');
      const text = await chatComplete({ system, user, maxTokens });
      try {
        return JSON.parse(text);
      } catch {
        return { text };
      }
    },
  };
}


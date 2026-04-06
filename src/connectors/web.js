import { z } from 'zod';

const ConfigSchema = z.object({
  allowDomains: z.array(z.string()).default(['*']),
  disallowDomains: z.array(z.string()).default([]),
  maxBytes: z.number().int().positive().default(1_000_000),
});

export function createWebConnector() {
  return {
    id: 'web',
    readOnly: true,
    getConfig(env) {
      return ConfigSchema.parse({
        allowDomains: env.WEB_ALLOW_DOMAINS ? String(env.WEB_ALLOW_DOMAINS).split(',').map((s) => s.trim()).filter(Boolean) : undefined,
        disallowDomains: env.WEB_DISALLOW_DOMAINS ? String(env.WEB_DISALLOW_DOMAINS).split(',').map((s) => s.trim()).filter(Boolean) : undefined,
        maxBytes: env.WEB_MAX_BYTES ? Number(env.WEB_MAX_BYTES) : undefined,
      });
    },
    async poll() {
      return [];
    },
    async executeAction() {
      throw new Error('Web connector does not support write actions');
    },
    async handleChat({ env, input }) {
      const trimmed = String(input || '').trim();
      const m = /^fetch\s+(.+)$/i.exec(trimmed);
      if (!m) return null;
      const url = m[1].trim();
      const cfg = this.getConfig(env);
      const u = new URL(url);
      if (!isAllowed(u.hostname, cfg.allowDomains, cfg.disallowDomains)) {
        throw new Error(`Domain not allowed: ${u.hostname}`);
      }
      const res = await fetch(url, {
        redirect: 'follow',
        headers: { 'user-agent': 'Sephir83/agent' },
      });
      const ct = res.headers.get('content-type') || '';
      const buf = await res.arrayBuffer();
      if (buf.byteLength > cfg.maxBytes) throw new Error(`Response too large: ${buf.byteLength} bytes`);
      const text = new TextDecoder().decode(buf);
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
      return { tool: 'web.fetch', url: res.url, contentType: ct, text };
    },
  };
}

function isAllowed(hostname, allow, disallow) {
  const lower = hostname.toLowerCase();
  if (disallow.some((d) => d !== '*' && lower === d.toLowerCase())) return false;
  if (allow.includes('*')) return true;
  return allow.some((d) => lower === d.toLowerCase());
}


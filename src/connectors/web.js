import { z } from 'zod';

export const WebConnector = {
  id: 'web',
  capabilities: ['browse'],
  configSchema: z.object({
    allowDomains: z.array(z.string()).default(['*']),
    disallowDomains: z.array(z.string()).default([]),
    maxBytes: z.number().int().positive().default(1_000_000),
  }),

  async init({ config }) {
    return {
      config,
      async fetchText(url) {
        const u = new URL(url);
        if (!isAllowed(u.hostname, config.allowDomains, config.disallowDomains)) {
          throw new Error(`Domain not allowed: ${u.hostname}`);
        }
        const res = await fetch(url, {
          redirect: 'follow',
          headers: { 'user-agent': 'Sephir83/agent' },
        });
        const ct = res.headers.get('content-type') || '';
        const buf = await res.arrayBuffer();
        if (buf.byteLength > config.maxBytes) throw new Error(`Response too large: ${buf.byteLength} bytes`);
        const text = new TextDecoder().decode(buf);
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
        return { url: res.url, contentType: ct, text };
      },
    };
  },
};

function isAllowed(hostname, allow, disallow) {
  const lower = hostname.toLowerCase();
  if (disallow.some((d) => d !== '*' && lower === d.toLowerCase())) return false;
  if (allow.includes('*')) return true;
  return allow.some((d) => lower === d.toLowerCase());
}


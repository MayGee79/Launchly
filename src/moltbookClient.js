function requiredEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name}`);
  return v;
}

function buildUrl(baseUrl, path, params = {}) {
  const url = new URL(path.replace(/^\//, ''), String(baseUrl || '').replace(/\/+$/, '') + '/');
  Object.entries(params).forEach(([k, v]) => {
    if (v === undefined || v === null || v === '') return;
    url.searchParams.set(k, String(v));
  });
  return url.toString();
}

async function httpJson(url, options) {
  const res = await fetch(url, options);
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`Non-JSON response (${res.status}): ${text.slice(0, 200)}`);
  }
  if (!res.ok) {
    const msg = json && (json.error || json.message) ? (json.error || json.message) : `HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

export class MoltbookClient {
  constructor({ baseUrl, apiKey } = {}) {
    this.baseUrl = baseUrl || process.env.MOLTBOOK_BASE_URL || 'https://www.moltbook.com/api/v1';
    this.apiKey = apiKey || process.env.MOLTBOOK_API_KEY || process.env.MOLTBOOK_AGENT_API_KEY || '';
  }

  authHeaders() {
    const apiKey = this.apiKey || requiredEnv('MOLTBOOK_API_KEY');
    return { Authorization: `Bearer ${apiKey}` };
  }

  async listPosts({ sort = 'new', limit = 25, offset } = {}) {
    const url = buildUrl(this.baseUrl, '/posts', { sort, limit, offset });
    const json = await httpJson(url, { headers: { ...this.authHeaders() } });
    return Array.isArray(json?.posts) ? json.posts : Array.isArray(json) ? json : [];
  }

  async listComments(postId, { sort = 'new', limit = 35, cursor } = {}) {
    if (!postId) throw new Error('postId is required');
    const url = buildUrl(this.baseUrl, `/posts/${encodeURIComponent(postId)}/comments`, {
      sort,
      limit,
      cursor,
    });
    const json = await httpJson(url, { headers: { ...this.authHeaders() } });
    return Array.isArray(json?.comments) ? json.comments : Array.isArray(json) ? json : [];
  }
}


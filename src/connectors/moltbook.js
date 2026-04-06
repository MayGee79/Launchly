import { z } from 'zod';

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

const ConfigSchema = z.object({
  baseUrl: z.string().default('https://www.moltbook.com/api/v1'),
  apiKey: z.string().min(1),
  sort: z.string().default('new'),
  maxPosts: z.number().int().min(1).max(100).default(25),
  maxCommentsPerPost: z.number().int().min(0).max(200).default(50),
});

export const moltbookConnector = {
  id: 'moltbook',
  displayName: 'Moltbook',
  readOnly: true,

  getConfig(env) {
    const parsed = ConfigSchema.parse({
      baseUrl: env.MOLTBOOK_BASE_URL || undefined,
      apiKey: env.MOLTBOOK_AGENT_API_KEY || env.MOLTBOOK_API_KEY || undefined,
      sort: env.MOLTBOOK_SORT || undefined,
      maxPosts: env.MOLTBOOK_MAX_POSTS ? Number(env.MOLTBOOK_MAX_POSTS) : undefined,
      maxCommentsPerPost: env.MOLTBOOK_MAX_COMMENTS_PER_POST
        ? Number(env.MOLTBOOK_MAX_COMMENTS_PER_POST)
        : undefined,
    });
    return parsed;
  },

  async poll({ env, memory, logger }) {
    const cfg = this.getConfig(env);
    const authHeaders = { Authorization: `Bearer ${cfg.apiKey}` };

    const lastSeenIso = memory.getState('moltbook.lastPostSeenAt', null);
    const lastSeenDate = lastSeenIso ? new Date(lastSeenIso) : null;

    const postsUrl = buildUrl(cfg.baseUrl, '/posts', { sort: cfg.sort, limit: cfg.maxPosts });
    const postsResp = await httpJson(postsUrl, { headers: authHeaders });
    const posts = Array.isArray(postsResp?.posts) ? postsResp.posts : Array.isArray(postsResp) ? postsResp : [];

    const newPosts = lastSeenDate
      ? posts.filter((p) => {
          const d = new Date(p.updated_at || p.created_at || 0);
          return Number.isFinite(d.getTime()) && d > lastSeenDate;
        })
      : posts;

    const items = [];
    for (const post of newPosts) {
      const postId = post.id || post._id;
      if (!postId) continue;

      let comments = [];
      try {
        const commentsUrl = buildUrl(cfg.baseUrl, `/posts/${encodeURIComponent(postId)}/comments`, {
          sort: 'new',
          limit: cfg.maxCommentsPerPost,
        });
        const commentsResp = await httpJson(commentsUrl, { headers: authHeaders });
        comments = Array.isArray(commentsResp?.comments) ? commentsResp.comments : Array.isArray(commentsResp) ? commentsResp : [];
      } catch (e) {
        logger.warn(`[moltbook] comments fetch failed for post=${postId}: ${String(e?.message || e)}`);
        comments = [];
      }

      const parts = [];
      if (post.title) parts.push(String(post.title));
      if (post.content) parts.push(String(post.content));

      for (const c of comments) {
        const author =
          c.author?.name || c.author?.id || c.author || c.user?.name || c.user?.id || c.user || 'unknown';
        const content = c.content || c.text || '';
        if (content) parts.push(`${author}: ${content}`.trim());
      }

      items.push({
        source: 'moltbook',
        id: String(postId),
        title: post.title || '',
        content: parts.join('\n'),
        url: post.url || post.permalink || '',
        created_at: post.updated_at || post.created_at || null,
        raw: { post, comments },
      });
    }

    const newest = posts
      .map((p) => new Date(p.updated_at || p.created_at || 0))
      .filter((d) => Number.isFinite(d.getTime()))
      .sort((a, b) => b - a)[0];

    if (newest) {
      memory.setState('moltbook.lastPostSeenAt', newest.toISOString());
    }

    return {
      ok: true,
      connector: this.id,
      scanned: posts.length,
      newItems: items.length,
      items,
    };
  },
};


import { spawnSync } from 'node:child_process';

function sh(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    ...opts,
  });
  if (res.error) throw res.error;
  if (res.status !== 0) {
    const err = new Error(res.stderr || `Command failed: ${cmd} ${args.join(' ')}`);
    err.code = res.status;
    throw err;
  }
  return res.stdout;
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function createGitHubConnector({ repo = null } = {}) {
  return {
    id: 'github',
    readOnly: true,
    async poll({ memory, logger }) {
      try {
        const repoArg = repo ? ['--repo', repo] : [];
        const prsText = sh('gh', ['pr', 'list', '--limit', '20', '--json', 'number,title,author,createdAt,url,state', ...repoArg]);
        const issuesText = sh('gh', ['issue', 'list', '--limit', '20', '--json', 'number,title,author,createdAt,url,state', ...repoArg]);
        const prs = safeJsonParse(prsText) || [];
        const issues = safeJsonParse(issuesText) || [];

        await memory.upsertObservation({
          connector: 'github',
          key: `snapshot:${new Date().toISOString().slice(0, 13)}`,
          title: 'GitHub snapshot (prs+issues)',
          content: JSON.stringify({ prs, issues }),
          url: null,
          createdAt: new Date().toISOString(),
          raw: { prs, issues },
        });

        return { ok: true, counts: { prs: prs.length, issues: issues.length } };
      } catch (e) {
        logger?.error?.(`[github] poll failed: ${e?.message || String(e)}`);
        return { ok: false, error: e?.message || String(e) };
      }
    },
    async act({ action, logger }) {
      if (!action) throw new Error('action is required');
      if (action.type !== 'github.comment') throw new Error('Unsupported GitHub action');
      const repoArg = repo ? ['--repo', repo] : [];
      if (!action.target || !action.target.number) throw new Error('Missing target.number');
      const body = String(action.payload?.body || '').trim();
      if (!body) throw new Error('Missing payload.body');
      sh('gh', ['pr', 'comment', String(action.target.number), '--body', body, ...repoArg]);
      logger?.log?.(`[github] commented on PR #${action.target.number}`);
      return { ok: true };
    },
    async propose({ memory }) {
      // Simple example: if an issue title contains "blocked", propose commenting on the newest PR.
      // This keeps proposing logic intentionally conservative and deterministic.
      const snapKey = `snapshot:${new Date().toISOString().slice(0, 13)}`;
      const snap = memory.getObservationByKey('github', snapKey);
      if (!snap?.raw?.issues?.length || !snap.raw.prs?.length) return [];

      const hasBlocked = snap.raw.issues.some((i) => String(i.title || '').toLowerCase().includes('blocked'));
      if (!hasBlocked) return [];

      const pr = snap.raw.prs[0];
      if (!pr?.number) return [];

      return [
        {
          connector: 'github',
          type: 'github.comment',
          title: 'Post a status comment on latest PR',
          rationale: 'Detected a “blocked” issue; propose notifying on the latest PR.',
          target: { number: pr.number },
          payload: { body: 'Autonomous agent note: I detected a “blocked” issue. Want me to investigate and propose a fix plan?' },
        },
      ];
    },
  };
}


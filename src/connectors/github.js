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
    async tools() {
      return {
        async listPRs({ limit = 20 } = {}) {
          const prsText = sh('gh', ['pr', 'list', '--limit', String(limit), '--json', 'number,title,url,state,createdAt,author']);
          return safeJsonParse(prsText) || [];
        },
        async listIssues({ limit = 20 } = {}) {
          const issuesText = sh('gh', ['issue', 'list', '--limit', String(limit), '--json', 'number,title,url,state,createdAt,author']);
          return safeJsonParse(issuesText) || [];
        },
        async viewPR({ number }) {
          if (!number) throw new Error('number is required');
          const text = sh('gh', ['pr', 'view', String(number), '--json', 'number,title,body,url,state,author,createdAt,comments']);
          return safeJsonParse(text) || null;
        },
      };
    },
  };
}


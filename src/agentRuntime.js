import { setTimeout as delay } from 'node:timers/promises';
import crypto from 'node:crypto';
import { openStore, getState, setState, insertReport, getLatestReport } from './store.js';
import { analyze } from './analyzer.js';
import { createMoltbookConnector } from './connectors/moltbook.js';
import { createGitHubConnector } from './connectors/github.js';
import { createWebConnector } from './connectors/web.js';
import { createFilesConnector } from './connectors/files.js';

function nowIso() {
  return new Date().toISOString();
}

function toNumber(value, fallback) {
  const n = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) ? n : fallback;
}

function stableId(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

function getConfig(env) {
  return {
    pollSeconds: Math.max(30, toNumber(env.POLL_SECONDS, 300)),
    storePath: env.STORE_PATH || './data/agent.db',
    readOnly: env.AGENT_READ_ONLY !== 'false',
    connectors: {
      moltbook: env.ENABLE_MOLTBOOK !== 'false',
      github: env.ENABLE_GITHUB === 'true',
      web: env.ENABLE_WEB === 'true',
      files: env.ENABLE_FILES === 'true',
    },
  };
}

export function createRuntime({ logger = console } = {}) {
  const cfg = getConfig(process.env);
  const db = openStore(cfg.storePath);

  const connectors = {
    moltbook: createMoltbookConnector({ logger }),
    github: createGitHubConnector({ logger }),
    web: createWebConnector({ logger }),
    files: createFilesConnector({ logger }),
  };

  const status = {
    startedAt: nowIso(),
    lastTickAt: null,
    lastError: null,
    enabled: cfg.connectors,
    readOnly: cfg.readOnly,
  };

  let started = false;

  async function tickOnce() {
    status.lastTickAt = nowIso();
    status.lastError = null;

    const observations = [];
    const enabledConnectors = Object.entries(cfg.connectors)
      .filter(([, enabled]) => enabled)
      .map(([name]) => name);

    for (const name of enabledConnectors) {
      const c = connectors[name];
      if (!c) continue;
      try {
        const items = await c.poll({ db, cfg });
        for (const item of items || []) {
          observations.push({ connector: name, ...item });
        }
      } catch (e) {
        status.lastError = `[${name}] ${String(e?.message || e)}`;
        logger.error(`[agent] connector poll failed ${name}: ${String(e?.message || e)}`);
      }
    }

    const analysis = analyze(observations, { minimumSignals: 1 });
    const reportId = stableId('rpt');
    insertReport(db, {
      id: reportId,
      created_at: nowIso(),
      window_start: getState(db, 'window_start', null),
      window_end: nowIso(),
      scanned_posts: analysis.summary.scanned,
      matched_posts: analysis.summary.matched,
      category_counts: analysis.summary.categoryCounts,
      matches: analysis.matches.slice(0, 50),
    });

    setState(db, 'last_report_id', reportId);
    return { reportId, analysis };
  }

  async function loop() {
    if (started) return;
    started = true;
    logger.log(`[agent] runtime started at ${status.startedAt}`);

    while (true) {
      try {
        await tickOnce();
      } catch (e) {
        status.lastError = String(e?.message || e);
        logger.error(`[agent] tick failed: ${status.lastError}`);
      }
      await delay(cfg.pollSeconds * 1000);
    }
  }

  async function chat(message) {
    const m = String(message || '').trim();
    if (!m) return { answer: 'Ask a question about what I have observed.' };

    const latest = getLatestReport(db);
    if (!latest) return { answer: 'No reports yet. The agent is still warming up.' };

    const lower = m.toLowerCase();
    const wantsTop = lower.includes('top') || lower.includes('most');
    const wantsGaps = lower.includes('gap');
    const wantsPain = lower.includes('pain') || lower.includes('problem') || lower.includes('issue');
    const wantsReq = lower.includes('request') || lower.includes('feature');

    const filtered = (latest.matches || []).filter((x) => {
      if (!x.mentions?.length) return false;
      if (wantsGaps) return x.mentions.some((mm) => mm.category === 'gaps');
      if (wantsPain) return x.mentions.some((mm) => mm.category === 'painPoints');
      if (wantsReq) return x.mentions.some((mm) => mm.category === 'unsatisfiedRequests');
      return true;
    });

    const out = wantsTop ? filtered.slice(0, 10) : filtered.slice(0, 25);
    return {
      answer: 'Here are the latest matched items from my most recent run.',
      report: {
        id: latest.id,
        created_at: latest.created_at,
        category_counts: latest.category_counts,
      },
      items: out,
    };
  }

  return {
    loop,
    chat,
    getStatus: () => ({ ...status, latestReport: getLatestReport(db) }),
  };
}


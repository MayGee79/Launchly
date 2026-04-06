import { setTimeout as delay } from 'node:timers/promises';
import crypto from 'node:crypto';
import {
  openStore,
  getState,
  setState,
  insertReport,
  getLatestReport,
  enqueueAction,
  listPendingActions,
  setActionStatus,
} from './store.js';
import { analyze } from './analyzer.js';
import { upsertEmbedding, searchEmbeddings } from './store.js';
import { createMoltbookConnector } from './connectors/moltbook.js';
import { createGitHubConnector } from './connectors/github.js';
import { createWebConnector } from './connectors/web.js';
import { createFilesConnector } from './connectors/files.js';
import { embedText } from './embeddings.js';
import { createLlmClient } from './llm.js';

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
    requireDailyApproval: env.REQUIRE_DAILY_APPROVAL !== 'false',
    llm: {
      enabled: env.LLM_ENABLED === 'true',
      provider: env.LLM_PROVIDER || 'openai',
      model: env.LLM_MODEL || '',
    },
    memory: {
      embeddingsEnabled: env.EMBEDDINGS_ENABLED === 'true',
      maxResults: Math.max(1, Math.min(25, toNumber(env.MEMORY_MAX_RESULTS, 8))),
    },
    connectors: {
      moltbook: env.ENABLE_MOLTBOOK !== 'false',
      github: env.ENABLE_GITHUB === 'true',
      web: env.ENABLE_WEB === 'true',
      files: env.ENABLE_FILES === 'true',
    },
    writes: {
      moltbook: env.MOLTBOOK_WRITE === 'true',
      github: env.GITHUB_WRITE === 'true',
    },
  };
}

export function createRuntime({ logger = console } = {}) {
  const cfg = getConfig(process.env);
  const db = openStore(cfg.storePath);
  const llm = cfg.llm.enabled ? createLlmClient(process.env, cfg.llm) : null;

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
    requireDailyApproval: cfg.requireDailyApproval,
    writes: cfg.writes,
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

    if (cfg.memory.embeddingsEnabled) {
      try {
        // Store embeddings for new observations so chat can retrieve older context quickly.
        for (const o of observations) {
          const text = [o.title, o.content].filter(Boolean).join('\n').slice(0, 4000);
          if (!text) continue;
          const vector = await embedText({
            provider: cfg.memory.embeddingProvider,
            apiKey: process.env.OPENAI_API_KEY,
            model: process.env.OPENAI_EMBED_MODEL,
            text,
          });
          upsertEmbedding(db, {
            id: stableId('mem'),
            connector: o.connector || o.source || 'unknown',
            title: o.title || '',
            url: o.url || '',
            text,
            created_at: o.created_at || nowIso(),
            vector,
          });
        }
      } catch (e) {
        logger.warn?.(`[agent] embeddings update failed: ${String(e?.message || e)}`);
      }
    }

    // Propose actions (do not execute automatically).
    if (!cfg.readOnly) {
      const proposed = proposeWriteActionsFromReport({ latestReport: getLatestReport(db), cfg });
      for (const action of proposed) {
        enqueueAction(db, action);
      }
    }
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

    const retrieved = cfg.memory.embeddingsEnabled
      ? await (async () => {
          try {
            const qText = m.slice(0, 4000);
            const qVec = await embedText({
              provider: cfg.memory.embeddingProvider,
              apiKey: process.env.OPENAI_API_KEY,
              model: process.env.OPENAI_EMBED_MODEL,
              text: qText,
            });
            return searchEmbeddings(db, qVec, { limit: 8 });
          } catch {
            return [];
          }
        })()
      : [];

    if (llm) {
      const system = `You are Sephir83, an autonomous agent with connectors (Moltbook, GitHub, web, files). You must be safe.\n` +
        `If the user requests write actions, propose them as actions but do not execute.\n` +
        `Answer concisely with JSON containing keys: answer, proposedActions? (array), references? (array).`;

      const context = {
        latestReport: {
          id: latest.id,
          created_at: latest.created_at,
          category_counts: latest.category_counts,
          matches: (latest.matches || []).slice(0, 15),
        },
        pendingActions: listPendingActions(db, 20),
        retrievedMemory: retrieved,
        config: {
          enabledConnectors: cfg.connectors,
          readOnly: cfg.readOnly,
          requireDailyApproval: cfg.requireDailyApproval,
          writes: cfg.writes,
        },
      };

      const completion = await llm.chat({
        system,
        user: `User question: ${m}\n\nContext JSON:\n${JSON.stringify(context)}`,
      });

      // If model proposes actions, enqueue them (still requires daily approval to execute).
      const proposedActions = Array.isArray(completion?.proposedActions) ? completion.proposedActions : [];
      if (!cfg.readOnly && proposedActions.length) {
        for (const pa of proposedActions) {
          enqueueAction(db, normalizeProposedAction(pa));
        }
      }
      return {
        answer: completion?.answer || completion?.text || 'Done.',
        proposedActions,
        references: completion?.references || [],
        pendingActions: listPendingActions(db, 20),
      };
    }

    // Fallback: keyword-based response.
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
      report: { id: latest.id, created_at: latest.created_at, category_counts: latest.category_counts },
      items: out,
      pendingActions: listPendingActions(db, 20),
    };
  }

  function normalizeProposedAction(pa) {
    const id = pa.id || stableId('act');
    return {
      id,
      created_at: nowIso(),
      connector: String(pa.connector || ''),
      action_type: String(pa.action_type || pa.type || ''),
      payload: pa.payload || {},
      status: 'queued',
    };
  }

  function approveForToday({ approvedBy = 'user' } = {}) {
    const today = new Date().toISOString().slice(0, 10);
    setState(db, 'approval.daily.date', today);
    setState(db, 'approval.daily.by', String(approvedBy || 'user'));
    setState(db, 'approval.daily.at', nowIso());
    return { ok: true, approvedForDate: today };
  }

  function isApprovedToday() {
    const today = new Date().toISOString().slice(0, 10);
    const approvedDate = getState(db, 'approval.daily.date', null);
    return approvedDate === today;
  }

  async function executePendingActions({ limit = 10 } = {}) {
    if (cfg.readOnly) throw new Error('Agent is in read-only mode');
    if (cfg.requireDailyApproval && !isApprovedToday()) {
      throw new Error('Daily approval required before executing actions');
    }

    const pending = listPendingActions(db, limit);
    const results = [];

    for (const a of pending) {
      try {
        const connectorId = a.connector;
        const connector = connectors[connectorId];
        if (!connector) throw new Error(`Unknown connector: ${connectorId}`);
        if (connectorId === 'github' && !cfg.writes.github) throw new Error('GitHub writes disabled');
        if (connectorId === 'moltbook' && !cfg.writes.moltbook) throw new Error('Moltbook writes disabled');

        if (typeof connector.executeAction !== 'function') {
          throw new Error(`Connector does not support executeAction(): ${connectorId}`);
        }

        setActionStatus(db, a.id, 'running', null);
        const out = await connector.executeAction({ env: process.env, db, cfg, action: a });
        setActionStatus(db, a.id, 'succeeded', null);
        results.push({ id: a.id, ok: true, result: out });
      } catch (e) {
        const msg = String(e?.message || e);
        setActionStatus(db, a.id, 'failed', msg);
        results.push({ id: a.id, ok: false, error: msg });
      }
    }

    return { ok: true, executed: results.length, results };
  }

  function proposeWriteActionsFromReport({ latestReport, cfg: runtimeCfg }) {
    if (!latestReport || !Array.isArray(latestReport.matches)) return [];
    const actions = [];

    // Very conservative default: only propose, never execute without explicit enable flags.
    if (runtimeCfg.writes.github) {
      // If there are unsatisfiedRequests, propose opening a GitHub issue as a placeholder.
      const hasUnsatisfied = latestReport.matches.some((m) =>
        (m.mentions || []).some((mm) => mm.category === 'unsatisfiedRequests')
      );
      if (hasUnsatisfied) {
        actions.push({
          connector: 'github',
          kind: 'issue.create',
          title: 'Agent: review unsatisfied requests detected',
          payload: {
            title: 'Agent: review unsatisfied requests detected',
            body: `Auto-generated placeholder from report ${latestReport.id} (${latestReport.created_at}).\n\nTop matches:\n` +
              latestReport.matches
                .slice(0, 5)
                .map((m) => `- ${m.title || m.id} (${m.url || ''})`)
                .join('\n'),
          },
        });
      }
    }

    return actions;
  }

  return {
    loop,
    chat,
    approveForToday,
    executePendingActions,
    getStatus: () => ({ ...status, latestReport: getLatestReport(db) }),
  };
}


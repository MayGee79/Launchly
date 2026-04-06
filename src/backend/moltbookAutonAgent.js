import wixData from 'wix-data';
import { searchMoltbookDiscussions } from 'backend/moltbookAgent.jsw';

const DEFAULT_CONFIG = {
  discussionCollection: 'MoltbookDiscussions',
  reportCollection: 'MoltbookAgentReports',
  stateCollection: 'MoltbookAgentState',
  stateId: 'moltbook-auton-agent',
  maxDiscussionsPerRun: 500,
  maxStoredMatchesPerRun: 40,
  onlyAgentToAgent: true,
  minimumSignals: 1,
};

/**
 * Autonomous scheduled job entrypoint.
 * Reads new/updated discussions, analyzes them, and stores a report.
 */
export async function runMoltbookAutonomousAgent() {
  const startedAt = new Date();
  let lastProcessedAt = null;

  try {
    const state = await loadState();
    lastProcessedAt = parseDate(state.lastProcessedAt);

    const discussionRecords = await loadDiscussionsSince(lastProcessedAt);
    const normalizedDiscussions = discussionRecords.map(mapDiscussionRecord);

    const analysis = searchMoltbookDiscussions({
      discussions: normalizedDiscussions,
      onlyAgentToAgent: DEFAULT_CONFIG.onlyAgentToAgent,
      minimumSignals: DEFAULT_CONFIG.minimumSignals,
    });

    const reportId = await saveReport({
      runAt: startedAt,
      scannedRecords: discussionRecords.length,
      summary: analysis.summary,
      matches: analysis.matches.slice(0, DEFAULT_CONFIG.maxStoredMatchesPerRun),
      config: {
        onlyAgentToAgent: DEFAULT_CONFIG.onlyAgentToAgent,
        minimumSignals: DEFAULT_CONFIG.minimumSignals,
      },
    });

    const newestUpdatedAt = getNewestUpdatedAt(discussionRecords) || lastProcessedAt;
    await saveState({
      lastRunAt: startedAt.toISOString(),
      lastProcessedAt: newestUpdatedAt ? newestUpdatedAt.toISOString() : null,
      lastReportId: reportId || null,
      lastStatus: 'success',
      lastError: null,
    });

    return {
      ok: true,
      runAt: startedAt.toISOString(),
      scannedRecords: discussionRecords.length,
      matchedDiscussions: analysis.summary.matchedDiscussions,
      reportId: reportId || null,
    };
  } catch (error) {
    await safeSaveStateOnError(startedAt, lastProcessedAt, error);
    return {
      ok: false,
      runAt: startedAt.toISOString(),
      error: safeError(error),
    };
  }
}

/**
 * Optional visibility helper for dashboards/admin tools.
 * Returns the latest persisted report and state snapshots.
 */
export async function getMoltbookAutonomousAgentStatus() {
  const [stateResult, reportResult] = await Promise.all([
    wixData
      .query(DEFAULT_CONFIG.stateCollection)
      .eq('_id', DEFAULT_CONFIG.stateId)
      .limit(1)
      .find(),
    wixData
      .query(DEFAULT_CONFIG.reportCollection)
      .descending('_createdDate')
      .limit(1)
      .find(),
  ]);

  return {
    state: stateResult.items[0] || null,
    latestReport: reportResult.items[0] || null,
  };
}

async function loadState() {
  const result = await wixData
    .query(DEFAULT_CONFIG.stateCollection)
    .eq('_id', DEFAULT_CONFIG.stateId)
    .limit(1)
    .find();

  return result.items[0] || { _id: DEFAULT_CONFIG.stateId };
}

async function loadDiscussionsSince(lastProcessedAt) {
  let query = wixData
    .query(DEFAULT_CONFIG.discussionCollection)
    .ascending('_updatedDate')
    .limit(1000);

  if (lastProcessedAt) {
    query = query.gt('_updatedDate', lastProcessedAt);
  }

  let results = await query.find();
  const records = [...results.items];

  while (hasNext(results) && records.length < DEFAULT_CONFIG.maxDiscussionsPerRun) {
    results = await results.next();
    records.push(...results.items);
  }

  return records.slice(0, DEFAULT_CONFIG.maxDiscussionsPerRun);
}

async function saveReport(report) {
  const item = {
    runAt: report.runAt,
    scannedRecords: report.scannedRecords,
    summary: report.summary,
    matches: report.matches,
    config: report.config,
  };

  const saved = await wixData.insert(DEFAULT_CONFIG.reportCollection, item);
  return saved && saved._id ? saved._id : null;
}

async function saveState(fields) {
  const item = {
    _id: DEFAULT_CONFIG.stateId,
    ...fields,
  };

  await wixData.save(DEFAULT_CONFIG.stateCollection, item);
}

async function safeSaveStateOnError(startedAt, lastProcessedAt, error) {
  try {
    await saveState({
      lastRunAt: startedAt.toISOString(),
      lastProcessedAt: lastProcessedAt ? lastProcessedAt.toISOString() : null,
      lastStatus: 'error',
      lastError: safeError(error),
    });
  } catch (stateError) {
    // Intentionally swallow state persistence failures so the job can fail safely.
  }
}

function mapDiscussionRecord(record = {}) {
  return {
    id: record._id || record.id || '',
    title: record.title || record.subject || '',
    content: record.content || record.text || record.description || '',
    participants: normalizeParticipants(record.participants || record.agents || []),
    messages: normalizeMessages(record.messages || record.thread || []),
  };
}

function normalizeParticipants(participants) {
  if (!Array.isArray(participants)) {
    return [];
  }
  return participants;
}

function normalizeMessages(messages) {
  if (Array.isArray(messages)) {
    return messages;
  }

  if (typeof messages === 'string') {
    try {
      const parsed = JSON.parse(messages);
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      return [messages];
    }
  }

  return [];
}

function getNewestUpdatedAt(records) {
  return records.reduce((latest, record) => {
    const date = parseDate(record && record._updatedDate);
    if (!date) return latest;
    if (!latest) return date;
    return date > latest ? date : latest;
  }, null);
}

function parseDate(input) {
  if (!input) return null;
  const parsed = new Date(input);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function hasNext(results) {
  if (!results) return false;
  if (typeof results.hasNext === 'function') return results.hasNext();
  return Boolean(results.hasNext);
}

function safeError(error) {
  if (!error) return 'Unknown error';
  if (typeof error === 'string') return error;
  if (error.message) return String(error.message);
  return JSON.stringify(error);
}

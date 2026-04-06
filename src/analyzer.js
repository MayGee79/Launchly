function lower(s) {
  return String(s || '').toLowerCase();
}

const DEFAULT_KEYWORDS = {
  gaps: ['gap', 'missing', 'lack', 'not available', "can't", 'no way to', 'does not support'],
  painPoints: ['pain point', 'friction', 'blocked', 'blocker', 'problem', 'issue', 'hard', 'slow', 'confusing', 'error', 'bug'],
  unsatisfiedRequests: ['request', 'feature request', 'please add', 'would like', 'need this', 'still waiting', 'unresolved', 'pending'],
};

function countOccurrences(text, query) {
  if (!query) return 0;
  let count = 0;
  let start = 0;
  while (start < text.length) {
    const idx = text.indexOf(query, start);
    if (idx === -1) break;
    count += 1;
    start = idx + query.length;
  }
  return count;
}

function excerpt(text, query) {
  const idx = text.indexOf(query);
  if (idx === -1) return '';
  const from = Math.max(0, idx - 60);
  const to = Math.min(text.length, idx + query.length + 60);
  return text.slice(from, to).replace(/\s+/g, ' ').trim();
}

function analyzeItem(item, keywords) {
  const text = lower([item.title, item.content].filter(Boolean).join('\n'));
  const mentions = [];
  for (const [category, words] of Object.entries(keywords)) {
    for (const w of words) {
      const q = lower(w);
      const c = countOccurrences(text, q);
      if (c) mentions.push({ category, keyword: w, count: c, excerpt: excerpt(text, q) });
    }
  }
  const signalCount = mentions.reduce((s, m) => s + m.count, 0);
  return { id: item.id, title: item.title || '', url: item.url || '', created_at: item.created_at || null, signalCount, mentions };
}

export function analyze(items, opts = {}) {
  const keywords = {
    gaps: [...DEFAULT_KEYWORDS.gaps, ...((opts.customKeywords && opts.customKeywords.gaps) || [])],
    painPoints: [...DEFAULT_KEYWORDS.painPoints, ...((opts.customKeywords && opts.customKeywords.painPoints) || [])],
    unsatisfiedRequests: [...DEFAULT_KEYWORDS.unsatisfiedRequests, ...((opts.customKeywords && opts.customKeywords.unsatisfiedRequests) || [])],
  };

  const minimumSignals = Number.isFinite(opts.minimumSignals) ? Math.max(1, opts.minimumSignals) : 1;
  const analyzed = (items || []).map((i) => analyzeItem(i, keywords));
  const matches = analyzed.filter((a) => a.signalCount >= minimumSignals).sort((a, b) => b.signalCount - a.signalCount);

  const categoryCounts = { gaps: 0, painPoints: 0, unsatisfiedRequests: 0 };
  for (const m of matches) for (const mention of m.mentions) categoryCounts[mention.category] += mention.count;

  return {
    summary: {
      scanned: analyzed.length,
      matched: matches.length,
      categoryCounts,
    },
    matches,
  };
}


export function renderPage({ title, bodyHtml }) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      :root { color-scheme: light dark; }
      body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; margin: 0; padding: 24px; }
      .wrap { max-width: 880px; margin: 0 auto; }
      .card { border: 1px solid rgba(127,127,127,.25); border-radius: 12px; padding: 16px; background: rgba(127,127,127,.05); }
      h1 { margin: 0 0 12px; font-size: 20px; }
      .row { display: flex; gap: 12px; align-items: stretch; }
      textarea { width: 100%; min-height: 74px; resize: vertical; padding: 10px; border-radius: 10px; border: 1px solid rgba(127,127,127,.35); background: transparent; }
      button { padding: 10px 14px; border-radius: 10px; border: 1px solid rgba(127,127,127,.35); background: rgba(127,127,127,.12); cursor: pointer; }
      button:hover { background: rgba(127,127,127,.18); }
      pre { white-space: pre-wrap; word-break: break-word; }
      .muted { opacity: .8; font-size: 12px; }
      .k { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
    </style>
  </head>
  <body>
    <div class="wrap">
      ${bodyHtml}
    </div>
  </body>
</html>`;
}

export function renderChatHome({ status }) {
  const statusHtml = status
    ? `<pre class="card"><span class="muted">Agent status</span>\n${escapeHtml(JSON.stringify(status, null, 2))}</pre>`
    : `<div class="card muted">No status yet. Worker may still be warming up.</div>`;

  return renderPage({
    title: 'Sephir83 — Autonomous Agent',
    bodyHtml: `
      <div class="card">
        <h1>Sephir83 (autonomous agent)</h1>
        <div class="muted">Ask it to summarize findings, browse the web, read local files, or query Moltbook/GitHub (read-only by default).</div>
        <div style="height:12px"></div>
        <div class="row">
          <textarea id="q" placeholder="e.g. Summarize top Moltbook pain points today, then check related GitHub issues"></textarea>
          <button id="send">Ask</button>
        </div>
        <div style="height:12px"></div>
        <pre id="out" class="card muted">Answer will appear here.</pre>
        <div style="height:12px"></div>
        <div class="muted">
          API: <span class="k">POST /api/chat</span> • Status: <span class="k">GET /api/status</span>
        </div>
      </div>
      <div style="height:16px"></div>
      ${statusHtml}
      <script>
        const q = document.getElementById('q');
        const out = document.getElementById('out');
        const send = document.getElementById('send');
        async function ask() {
          const question = q.value.trim();
          if (!question) return;
          out.classList.remove('muted');
          out.textContent = 'Thinking...';
          const res = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ question })
          });
          const data = await res.json().catch(() => ({}));
          out.textContent = JSON.stringify(data, null, 2);
        }
        send.addEventListener('click', ask);
        q.addEventListener('keydown', (e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') ask();
        });
      </script>
    `,
  });
}

function escapeHtml(input) {
  return String(input ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

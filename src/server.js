import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRuntime } from './agentRuntime.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: '1mb' }));

const runtime = createRuntime();
runtime.loop();

app.get('/health', async (req, res) => {
  res.json({ ok: true, status: runtime.getStatus() });
});

app.get('/api/status', async (req, res) => {
  res.json({ ok: true, status: runtime.getStatus() });
});

app.post('/api/approve', async (req, res) => {
  try {
    const result = await runtime.approveForToday();
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

app.post('/api/actions/execute', async (req, res) => {
  try {
    const result = await runtime.executePendingActions();
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

app.post('/api/chat', async (req, res) => {
  try {
    const { message, question } = req.body || {};
    const result = await runtime.chat(String(question || message || ''));
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

app.get('/', async (req, res) => {
  res.sendFile(path.join(__dirname, 'ui', 'index.html'));
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`Sephir83 listening on :${port}`);
});


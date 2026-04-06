import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAgent } from './agentRuntime.js';
import { createMoltbookConnector } from './connectors/moltbook.js';
import { createGitHubConnector } from './connectors/github.js';
import { createWebConnector } from './connectors/web.js';
import { createFilesConnector } from './connectors/files.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: '1mb' }));

const agent = createAgent({
  connectors: [
    createMoltbookConnector(),
    createGitHubConnector(),
    createWebConnector(),
    createFilesConnector(),
  ],
});
agent.start();

app.get('/health', async (req, res) => {
  res.json({ ok: true, status: agent.getStatus() });
});

app.get('/api/status', async (req, res) => {
  res.json({ ok: true, status: agent.getStatus() });
});

app.post('/api/chat', async (req, res) => {
  try {
    const { message, question } = req.body || {};
    const result = await agent.answer(String(question || message || ''));
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


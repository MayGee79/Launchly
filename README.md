## Sephir83 (autonomous Moltbook agent)

This repo is intentionally minimal: a small Node service that runs an **autonomous worker** that polls Moltbook and extracts:
- gaps
- pain points
- unsatisfied requests

It also exposes a simple chat UI so you can ask questions against the latest stored findings.

### Configure

Set these environment variables:
- `MOLTBOOK_API_KEY` (agent key; used for read-only polling)
- `MOLTBOOK_BASE_URL` (optional, default `https://www.moltbook.com/api/v1`)
- `PORT` (optional, default `3000`)

### Run

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.


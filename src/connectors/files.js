import fs from 'node:fs/promises';
import path from 'node:path';

function startsWithPath(candidate, prefix) {
  const rel = path.relative(prefix, candidate);
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

export function createFilesConnector({ rootDir, allowList = [] }) {
  const allowedRoots = (allowList.length ? allowList : [rootDir])
    .filter(Boolean)
    .map((p) => path.resolve(rootDir, p));

  function assertAllowed(filePath) {
    const abs = path.resolve(rootDir, filePath);
    const ok = allowedRoots.some((r) => abs === r || startsWithPath(abs, r));
    if (!ok) throw new Error('File path not allowed by policy');
    return abs;
  }

  return {
    name: 'files',
    capabilities: ['read'],
    async poll() {
      return [];
    },
    async handleChat({ input, maxBytes = 200_000 }) {
      const trimmed = String(input || '').trim();
      const m = /^read\s+(.+)$/i.exec(trimmed);
      if (!m) return null;
      const filePath = m[1].trim();
      const abs = assertAllowed(filePath);
      const buf = await fs.readFile(abs);
      if (buf.byteLength > maxBytes) throw new Error('File too large for chat response');
      return {
        tool: 'files.read',
        filePath,
        bytes: buf.byteLength,
        content: buf.toString('utf8'),
      };
    },
  };
}


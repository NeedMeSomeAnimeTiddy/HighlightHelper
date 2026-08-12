/**
 * A static file server for the browser-based tests, and nothing else.
 *
 * test/locate-browser.html imports the real modules rather than a copy of
 * them, so it needs an origin — ES modules do not load over file://. Node's
 * own http module; there are no dependencies in this repo and this does not
 * add one.
 *
 *   node tools/static-server.js
 *   http://localhost:8712/test/locate-browser.html
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';

const ROOT = resolve(process.cwd());
const PORT = 8712;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8'
};

createServer(async (req, res) => {
  const requested = decodeURIComponent(req.url.split('?')[0]);
  // resolve() collapses any "..", and the prefix check is what confines the
  // result to the repo — a served path that escaped it would be a real hole,
  // even in a test-only tool.
  const path = resolve(join(ROOT, requested));
  if (path !== ROOT && !path.startsWith(ROOT + sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  try {
    const body = await readFile(path);
    res.writeHead(200, { 'Content-Type': TYPES[extname(path)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('Not found');
  }
}).listen(PORT, () => {
  console.log(`serving ${ROOT} on http://localhost:${PORT}`);
});

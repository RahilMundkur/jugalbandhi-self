/**
 * server.js — Serve Jugalbandhi and proxy DeepL translations
 *
 * Two responsibilities:
 *   1. Serves Jugalbandhi_reader.html at GET /
 *   2. Proxies DeepL API calls at POST /translate (adds your API key server-side)
 *
 * This way readers get instant translations without ever seeing your DeepL key.
 *
 * Requirements: Node.js (no npm packages needed)
 *
 * Usage:
 *   DEEPL_KEY=your-key node server.js
 *   node server.js --key your-key
 *   node server.js --key your-key --port 8080
 *
 * Then open http://localhost:7477 in your browser.
 *
 * To deploy: upload both files to any Node.js host (Railway, Render, Fly.io, etc.)
 * and set the DEEPL_KEY environment variable.
 */

const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');
const url   = require('url');

// ---- Config ----------------------------------------------------------------

const args     = process.argv.slice(2);
const keyFlag  = args.indexOf('--key');
const portFlag = args.indexOf('--port');

const DEEPL_KEY = keyFlag  >= 0 ? args[keyFlag  + 1] : (process.env.DEEPL_KEY || '');
const PORT      = portFlag >= 0 ? parseInt(args[portFlag + 1], 10) : parseInt(process.env.PORT || '7477', 10);
const HTML_FILE = path.join(__dirname, 'Jugalbandhi_reader.html');

if (!DEEPL_KEY) {
  console.warn('Warning: No DeepL key configured. Translation proxy will return errors.');
  console.warn('Set DEEPL_KEY environment variable or use --key flag.\n');
}

// ---- DeepL proxy -----------------------------------------------------------

function proxyDeepL(body, res) {
  const host     = DEEPL_KEY.endsWith(':fx') ? 'api-free.deepl.com' : 'api.deepl.com';
  const payload  = JSON.stringify({
    text:        [body.text || ''],
    target_lang: body.target_lang || 'ES',
    source_lang: body.source_lang || 'EN',
  });

  const options = {
    hostname: host,
    path:     '/v2/translate',
    method:   'POST',
    headers: {
      'Authorization':  `DeepL-Auth-Key ${DEEPL_KEY}`,
      'Content-Type':   'application/json',
      'Content-Length': Buffer.byteLength(payload),
    },
  };

  const req = https.request(options, upstream => {
    let data = '';
    upstream.on('data', c => data += c);
    upstream.on('end', () => {
      try {
        const parsed = JSON.parse(data);
        if (upstream.statusCode !== 200) {
          res.writeHead(upstream.statusCode, { 'Content-Type': 'application/json' });
          res.end(data);
          return;
        }
        const translation = parsed.translations?.[0]?.text || '';
        res.writeHead(200, {
          'Content-Type':                'application/json',
          'Access-Control-Allow-Origin': '*',
        });
        res.end(JSON.stringify({ translation }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to parse DeepL response' }));
      }
    });
  });
  req.on('error', e => {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: e.message }));
  });
  req.write(payload);
  req.end();
}

// ---- HTTP server -----------------------------------------------------------

const server = http.createServer((req, res) => {
  const { pathname } = url.parse(req.url);

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin':  '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  // Serve the reader
  if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
    if (!fs.existsSync(HTML_FILE)) {
      res.writeHead(404);
      res.end('Jugalbandhi_reader.html not found next to server.js');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    fs.createReadStream(HTML_FILE).pipe(res);
    return;
  }

  // Translation proxy
  if (req.method === 'POST' && pathname === '/translate') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      let parsed;
      try { parsed = JSON.parse(body); }
      catch { res.writeHead(400); res.end('Invalid JSON'); return; }
      proxyDeepL(parsed, res);
    });
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`\nJugalbandhi server running at http://localhost:${PORT}`);
  console.log(`DeepL key: ${DEEPL_KEY ? '✓ configured' : '✗ missing'}\n`);
});

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import zlib from 'node:zlib';

const ROOT = process.cwd();
const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 4321);
const IS_PROD = process.env.NODE_ENV === 'production';

// Strictly allowlisted public assets (backend/config files always return 404)
const ALLOWLIST_ROOT_FILES = new Set([
  'index.html',
  '404.html',
  'robots.txt',
  'sitemap.xml',
  'favicon.svg',
  'favicon.png',
  'hosila-icon.svg',
  'Hosila-icon-logo.png',
  'og-cover.png',
  'sw.js',
]);

const ALLOWLIST_DIRS = new Set([
  'products',
  'downloads',
  'releases',
  'pricing',
  'contact',
  'docs',
  'css',
  'js',
  'vendor',
  'fonts',
  'mockups',
  'pagefind',
  '_astro',
]);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.pf_meta': 'application/octet-stream',
  '.pf_fragment': 'application/octet-stream',
  '.pf_index': 'application/octet-stream',
  '.pagefind': 'application/octet-stream',
};

const COMPRESSIBLE_EXT = new Set(['.html', '.css', '.js', '.mjs', '.json', '.xml', '.txt', '.svg']);
const RELEASE_FILENAMES = {
  'hosila-pms': 'Hosila-PMS-Setup.exe',
  'hosila-ims': 'Hosila-IMS-Setup.exe',
};

// Lightweight per-IP rate limiter for download endpoints (60 requests / minute)
const rateBuckets = new Map();
function isRateLimited(ip) {
  const now = Date.now();
  const entry = rateBuckets.get(ip);
  if (!entry || now > entry.resetAt) {
    rateBuckets.set(ip, { count: 1, resetAt: now + 60_000 });
    return false;
  }
  entry.count += 1;
  return entry.count > 60;
}

function getSecurityHeaders(req) {
  const headers = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
  };
  if (IS_PROD || req.headers['x-forwarded-proto'] === 'https') {
    headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
  }
  return headers;
}

function sendJson(req, res, data, status = 200) {
  res.writeHead(status, {
    ...getSecurityHeaders(req),
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(data));
}

function getDownloadVersion(product) {
  const mdPath = path.join(ROOT, 'releases-md', product === 'hosila-pms' ? 'pms-1.0.0.md' : 'ims-1.0.0.md');
  try {
    const raw = fs.readFileSync(mdPath, 'utf8');
    const m = raw.match(/^version:\s*"?([^"\r\n]+)"?/m);
    if (m) return m[1].trim();
  } catch {}
  return '1.0.0';
}

function handleDownload(req, res, product, headOnly) {
  const ip = String(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown');
  if (isRateLimited(ip)) {
    return sendJson(req, res, { error: 'Too many download requests. Please wait a minute and try again.' }, 429);
  }

  const localFileName = RELEASE_FILENAMES[product];
  if (!localFileName) {
    return sendJson(req, res, { error: 'Unknown Hosila product installer.' }, 404);
  }

  const cdnBase = process.env.PUBLIC_RELEASES_CDN_URL?.trim();
  if (cdnBase) {
    const version = getDownloadVersion(product);
    res.writeHead(302, {
      ...getSecurityHeaders(req),
      Location: `${cdnBase.replace(/\/+$/, '')}/${product}/${version}/${localFileName}`,
      'Cache-Control': 'no-cache',
    });
    return res.end();
  }

  if (IS_PROD) {
    return sendJson(req, res, { error: 'PUBLIC_RELEASES_CDN_URL is not configured for production downloads.' }, 503);
  }

  const localPath = path.resolve(ROOT, '..', 'Hosila Releases', localFileName);
  if (!fs.existsSync(localPath)) {
    return sendJson(req, res, { error: 'Installer binary not found on local release host.' }, 404);
  }

  const stat = fs.statSync(localPath);
  const headers = {
    ...getSecurityHeaders(req),
    'Content-Type': 'application/octet-stream',
    'Content-Disposition': `attachment; filename="${localFileName}"`,
    'Content-Length': String(stat.size),
    'Cache-Control': 'no-cache',
  };

  if (headOnly) {
    res.writeHead(200, headers);
    return res.end();
  }

  res.writeHead(200, headers);
  const stream = fs.createReadStream(localPath);
  stream.on('error', () => {
    if (!res.headersSent) res.writeHead(500);
    res.end();
  });
  stream.pipe(res);
}

function resolvePublicFile(rawPathname) {
  let pathname = rawPathname;
  try {
    pathname = decodeURIComponent(rawPathname);
  } catch {
    return null;
  }

  const clean = pathname.replace(/^\/+/, '');
  if (!clean) return path.join(ROOT, 'index.html');

  const segments = clean.split('/');
  if (segments.some((s) => s === '..' || s === '.' || s.startsWith('.'))) {
    return null;
  }

  if (segments.length === 1) {
    if (ALLOWLIST_ROOT_FILES.has(segments[0])) {
      const candidate = path.join(ROOT, segments[0]);
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    }
    if (ALLOWLIST_DIRS.has(segments[0])) {
      const idx = path.join(ROOT, segments[0], 'index.html');
      if (fs.existsSync(idx) && fs.statSync(idx).isFile()) return idx;
    }
    return null;
  }

  if (!ALLOWLIST_DIRS.has(segments[0])) return null;

  const abs = path.resolve(ROOT, clean);
  if (!abs.startsWith(ROOT)) return null;

  if (fs.existsSync(abs)) {
    const stat = fs.statSync(abs);
    if (stat.isFile()) return abs;
    if (stat.isDirectory()) {
      const idx = path.join(abs, 'index.html');
      if (fs.existsSync(idx) && fs.statSync(idx).isFile()) return idx;
    }
  }

  return null;
}

function sendStaticFile(req, res, filePath, status = 200) {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  const rel = path.relative(ROOT, filePath).replace(/\\/g, '/');
  const isImmutable =
    rel.startsWith('fonts/') || rel.startsWith('vendor/') || rel.startsWith('mockups/') || rel.startsWith('_astro/');

  const headers = {
    ...getSecurityHeaders(req),
    'Content-Type': contentType,
    'Cache-Control': isImmutable ? 'public, max-age=31536000, immutable' : 'public, max-age=300',
  };

  if (req.method === 'HEAD') {
    const stat = fs.statSync(filePath);
    headers['Content-Length'] = String(stat.size);
    res.writeHead(status, headers);
    return res.end();
  }

  const acceptEncoding = String(req.headers['accept-encoding'] || '');
  const canCompress = COMPRESSIBLE_EXT.has(ext);
  const raw = fs.readFileSync(filePath);

  if (canCompress && acceptEncoding.includes('br')) {
    const compressed = zlib.brotliCompressSync(raw);
    headers['Content-Encoding'] = 'br';
    headers['Vary'] = 'Accept-Encoding';
    headers['Content-Length'] = String(compressed.length);
    res.writeHead(status, headers);
    return res.end(compressed);
  }
  if (canCompress && acceptEncoding.includes('gzip')) {
    const compressed = zlib.gzipSync(raw);
    headers['Content-Encoding'] = 'gzip';
    headers['Vary'] = 'Accept-Encoding';
    headers['Content-Length'] = String(compressed.length);
    res.writeHead(status, headers);
    return res.end(compressed);
  }

  headers['Content-Length'] = String(raw.length);
  res.writeHead(status, headers);
  return res.end(raw);
}

const server = http.createServer((req, res) => {
  try {
    const urlObj = new URL(req.url || '/', `http://${req.headers.host || `${HOST}:${PORT}`}`);
    const pathname = urlObj.pathname;

    if (pathname === '/health') {
      return sendJson(req, res, { ok: true, mode: IS_PROD ? 'production' : 'local' });
    }

    if (pathname.startsWith('/api/download/') && (req.method === 'GET' || req.method === 'HEAD')) {
      const product = pathname.slice('/api/download/'.length).replace(/\/+$/, '');
      return handleDownload(req, res, product, req.method === 'HEAD');
    }

    if (pathname.startsWith('/api/')) {
      return sendJson(req, res, { error: 'Not found.' }, 404);
    }

    // Canonical 301 redirects
    if (pathname === '/index.html') {
      res.writeHead(301, { ...getSecurityHeaders(req), Location: '/' });
      return res.end();
    }
    if (pathname === '/sitemap-index.xml') {
      res.writeHead(301, { ...getSecurityHeaders(req), Location: '/sitemap.xml' });
      return res.end();
    }
    if (pathname === '/activate' || pathname === '/activate/') {
      res.writeHead(301, { ...getSecurityHeaders(req), Location: '/contact' });
      return res.end();
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { ...getSecurityHeaders(req), Allow: 'GET, HEAD' });
      return res.end();
    }

    const filePath = resolvePublicFile(pathname);
    if (filePath) {
      return sendStaticFile(req, res, filePath, 200);
    }

    const notFoundPath = path.join(ROOT, '404.html');
    if (fs.existsSync(notFoundPath)) {
      return sendStaticFile(req, res, notFoundPath, 404);
    }
    res.writeHead(404, { ...getSecurityHeaders(req), 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
  } catch {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Internal Server Error');
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Hosila Static & Release Server listening on http://${HOST}:${PORT}`);
});

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, '.docs-dist');

if (!fs.existsSync(DIST)) {
  console.error('.docs-dist directory not found. Run astro build first.');
  process.exit(1);
}

for (const sub of ['docs', 'pagefind', '_astro']) {
  const src = path.join(DIST, sub);
  const dst = path.join(ROOT, sub);
  fs.rmSync(dst, { recursive: true, force: true });
  if (fs.existsSync(src)) {
    fs.cpSync(src, dst, { recursive: true });
  }
}

fs.rmSync(DIST, { recursive: true, force: true });

// Remove redundant Starlight <link rel="sitemap" href="/sitemap-index.xml"/> so only /sitemap.xml is advertised
function cleanDocLinks(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) cleanDocLinks(abs);
    else if (entry.name.endsWith('.html')) {
      const html = fs.readFileSync(abs, 'utf8').replace(/<link rel="sitemap" href="\/sitemap-index\.xml"\s*\/?>/g, '');
      fs.writeFileSync(abs, html, 'utf8');
    }
  }
}
cleanDocLinks(path.join(ROOT, 'docs'));

console.log('Copied built Starlight docs, pagefind, and _astro into Hosila Website root.');

import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium } from '@playwright/test';

// One-time development asset import. Never execute the reference document.
const path = process.argv[2];
if (!path) throw new Error('Usage: node scripts/import-email-reference-images.mjs reference.html');
const source = await readFile(path, 'utf8');
const matches = [...source.matchAll(/<img\b[^>]*src="data:image\/svg\+xml;base64,([^"]+)"[^>]*>/g)];
const unique = [...new Set(matches.map(match => match[1]))];
const names = ['temple', 'street', 'river', 'shrine', 'noodles', 'beef', 'gyoza'];
if (unique.length !== names.length) throw new Error('Expected the seven original sample illustrations.');
const output = new URL('../apps/web/public/email-reference/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage();
await page.route('**/*', route => route.abort());
const assets = [];
try {
  for (const [index, encoded] of unique.entries()) {
    const svg = Buffer.from(encoded, 'base64').toString('utf8');
    if (/<(?:script|foreignObject)\b|\son\w+\s*=|(?:href|url\()\s*["']?https?:/i.test(svg)) throw new Error('Reference illustration contains active or remote content.');
    const size = svg.match(/<svg[^>]*width="(\d+)"[^>]*height="(\d+)"/);
    if (!size) throw new Error('Reference illustration has no intrinsic size.');
    const width = Number(size[1]); const height = Number(size[2]);
    await page.setViewportSize({ width, height });
    await page.setContent(`<html><body style="margin:0">${svg}</body></html>`);
    const png = await page.screenshot({ type: 'png' });
    await writeFile(new URL(`${names[index]}.png`, output), png);
    assets.push({ name: names[index], width, height, sourceSvgSha256: createHash('sha256').update(svg).digest('hex'), pngSha256: createHash('sha256').update(png).digest('hex') });
  }
} finally { await browser.close(); }
await writeFile(new URL('provenance.json', output), JSON.stringify({ source: 'User-provided Landi four-email visual reference', sourceSha256: createHash('sha256').update(source).digest('hex'), usage: 'Development preview illustrations; not hosted production email assets', assets }, null, 2) + '\n');
console.log(`Imported ${assets.length} reference illustrations as PNG.`);

import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const origin = process.env.LANDI_EMAIL_PREVIEW_ORIGIN ?? 'http://127.0.0.1:5186';
const output = resolve(process.argv[2] ?? '/private/tmp/landi-email-verification');
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
const results = [];
const startedAt = new Date().toISOString();
try {
  const context = await browser.newContext({ deviceScaleFactor: 1, colorScheme: 'light' });
  let blockImages = false;
  await context.route('**/*', route => !blockImages || route.request().resourceType() !== 'image' ? (new URL(route.request().url()).origin === origin ? route.continue() : route.abort()) : route.abort());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  for (const width of [375, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    for (const kind of ['morning', 'transfer', 'dining', 'change']) {
      await page.goto(`${origin}/email-preview.html?mail=${kind}&width=${width}&bare=1&theme=light`);
      const frame = page.frameLocator('#email-frame');
      await frame.locator('h1').waitFor();
      await frame.locator('body').evaluate(async body => { await Promise.all([...body.querySelectorAll('img')].map(image => image.complete ? Promise.resolve() : new Promise(resolve => { image.onload = resolve; image.onerror = resolve; }))); });
      const dimensions = await frame.locator('body').evaluate(body => ({ viewport: innerWidth, scroll: document.documentElement.scrollWidth, height: body.getBoundingClientRect().height, images: [...body.querySelectorAll('img')].map(image => ({ loaded: image.naturalWidth > 0, alt: image.alt, decorative: image.getAttribute("alt") === "" })), buttonHeights: [...body.querySelectorAll('a.primary-button,a.secondary-button')].map(link => link.getBoundingClientRect().height) }));
      const language = await frame.locator("body").innerText();
      assert.doesNotMatch(language, /\p{Script=Han}/u);
      if (kind === "morning") {
        const rail = await frame.locator("body").evaluate(body => [...body.querySelectorAll(".timeline-rail")].map(cell => { const dot=cell.querySelector(".timeline-dot").getBoundingClientRect(), rect=cell.getBoundingClientRect(), title=cell.parentElement.querySelector(".timeline-title").getBoundingClientRect(); return { offset: Math.abs(dot.x+dot.width/2-rect.x-rect.width/2), top: Math.abs(dot.y-title.y-6), background:getComputedStyle(cell).backgroundImage }; }));
        assert.ok(rail.every(node => node.offset <= 1 && node.top <= 1 && node.background.includes("linear-gradient")), `Continuous rail geometry: ${JSON.stringify(rail)}`);
        assert.equal(await frame.getByText("Planned", {exact:true}).count(), 0);
      }
      assert.ok(dimensions.scroll <= width, `${kind} overflows at ${width}`);
      assert.ok(dimensions.images.every(image => image.loaded && (image.alt || image.decorative)), `${kind} image failed`);
      assert.ok(dimensions.buttonHeights.every(height => height >= 44), `${kind} tap target too small`);
      await page.locator('#email-frame').screenshot({ path: `${output}/${kind}-${width}.png` });
      results.push({ kind, width, mode: 'light', ...dimensions });
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  for (const kind of ['morning', 'transfer', 'dining', 'change']) {
    for (const mode of ['dark', 'images-off']) {
      blockImages = mode === 'images-off';
      await page.goto(`${origin}/email-preview.html?mail=${kind}&bare=1&theme=${mode === 'dark' ? 'dark' : 'light'}&images=${mode === 'images-off' ? 'off' : 'on'}`);
      const frame = page.frameLocator('#email-frame');
      await frame.locator('h1').waitFor();
      const status = await frame.locator('body').evaluate(body => ({ overflow: document.documentElement.scrollWidth > innerWidth, title: body.querySelector('h1').textContent, background: getComputedStyle(body).backgroundColor, imageCount: body.querySelectorAll('img').length, textLength: body.innerText.length, loadedImages: [...body.querySelectorAll('img')].filter(image => image.naturalWidth > 0).length, actionableLinks: body.querySelectorAll('a[href]').length }));
      assert.equal(status.overflow, false);
      if (kind === "transfer") assert.ok(status.actionableLinks >= 1 && status.title.trim().length > 0);
      else assert.ok(status.textLength > 300);
      if (mode === 'dark') assert.equal(status.background, 'rgb(30, 41, 36)');
      if (mode === 'images-off') { assert.equal(status.loadedImages, 0); if (kind === 'change') assert.ok(status.title.trim().length > 0 && status.textLength > 300); else assert.ok(status.actionableLinks > 0); }
      await page.locator('#email-frame').screenshot({ path: `${output}/${kind}-${mode}.png` });
      results.push({ kind, width: 390, mode, ...status });
    }
  }
  blockImages = false;
  // Morning has long dynamic titles and must keep its timed rail aligned while wrapping.
  await page.setViewportSize({ width: 375, height: 844 });
  await page.goto(`${origin}/email-preview.html?mail=morning&bare=1&theme=light`);
  const morning = page.frameLocator('#email-frame');
  await morning.locator('h1').evaluate(element => { element.textContent = 'A LONG TRAVEL TITLE ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ'; });
  await morning.locator('.timeline-title').first().evaluate(element => { element.textContent = 'A LONG DESTINATION ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ'; });
  assert.equal(await morning.locator('body').evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.locator('#email-frame').screenshot({ path: `${output}/morning-long-text-375.png` });
  results.push({ kind: 'morning', width: 375, mode: 'long-text', overflow: false });
  // Stress natural wrapping in the smallest viewport without truncation.
  await page.setViewportSize({ width: 375, height: 844 });
  await page.goto(`${origin}/email-preview.html?mail=dining&bare=1&theme=light`);
  const frame = page.frameLocator('#email-frame');
  await frame.locator('h1').waitFor();
  await frame.getByText('Gion Duck Noodles', { exact: true }).evaluate(element => { element.textContent = 'A VERY LONG RESTAURANT NAME ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ'; });
  const overflow = await frame.locator('body').evaluate(() => document.documentElement.scrollWidth > innerWidth);
  assert.equal(overflow, false, 'Long restaurant name overflows');
  await page.locator('#email-frame').screenshot({ path: `${output}/dining-long-text-375.png` });
  results.push({ kind: 'dining', width: 375, mode: 'long-text', overflow });
  // Preview controls operate outside the script-free email frame.
  await page.setViewportSize({ width: 430, height: 844 });
  await page.goto(`${origin}/email-preview.html`);
  await page.getByRole('button', { name: 'Dining', exact: true }).click();
  await page.frameLocator('#email-frame').getByRole('heading', { name: 'Lunch around Gion' }).waitFor();
  await page.locator('#preview-width').selectOption('375');
  assert.equal(await page.locator('#email-frame').evaluate(element => element.getBoundingClientRect().width), 375);
  assert.equal(errors.length, 0, errors.join('\n'));
  results.push({ mode: 'preview-controls', passed: true });
} finally { await browser.close(); }
await writeFile(`${output}/report.json`, JSON.stringify({ startedAt, finishedAt: new Date().toISOString(), browser: 'Playwright Chromium', realEmailClientsTested: false, results }, null, 2) + '\n');
console.log(`Passed ${results.length} browser scenarios. Screenshots and report: ${output}`);

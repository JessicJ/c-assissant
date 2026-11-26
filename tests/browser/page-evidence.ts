import { test, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// 采集证据不代表验收；隔离 runner 为每次运行及场景提供独立目录。
export async function pageEvidence(page: Page, name: string) {
  const root = process.env.LANDI_PAGE_EVIDENCE_DIR;
  if (!root) return;
  if (!path.isAbsolute(root) || !/^[a-z0-9-]+$/.test(name)) throw new Error('页面证据目录或名称无效');
  const info = test.info();
  const directory = path.join(root, info.testId);
  mkdirSync(directory, { recursive: true });
  const browser = page.context().browser();
  const visibleText = await page.locator('body').innerText();
  await page.screenshot({ path: path.join(directory, `${name}.png`), fullPage: true });
  writeFileSync(path.join(directory, `${name}.json`), JSON.stringify({
    status: 'captured', checkpoint: name, test: info.title, scenario: process.env.LANDI_BOOKING_SCENARIO,
    createdAt: new Date().toISOString(), url: page.url(), viewport: page.viewportSize(),
    browserVersion: browser?.version(), executable: browser?.browserType().executablePath(),
    headless: info.project.use.headless ?? true, workerPid: process.pid, visibleText
  }, null, 2));
}

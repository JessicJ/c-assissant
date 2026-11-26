import { test as base } from '@playwright/test';
import { pageEvidence } from './page-evidence';

// 仅在测试使用页面时采集；纯 API 测试不因此启动浏览器。
export const test = base.extend({
  page: async ({ page }, use) => {
    await use(page);
    if (!page.isClosed() && page.url() !== 'about:blank') await pageEvidence(page, 'final');
  }
});

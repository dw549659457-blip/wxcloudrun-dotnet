import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? '/usr/bin/chromium',
  headless: true,
});
try {
  const page = await browser.newPage({ viewport: { width: 688, height: 1020 } });
  const failures = [];
  page.on('pageerror', (error) => failures.push(error.message));
  await page.route('**/*', (route) =>
    /^(file:|data:)/.test(route.request().url()) ? route.continue() : route.abort(),
  );
  await page.setContent(
    await readFile(resolve(root, 'deliverables/user-manual-1.2.1.html'), 'utf8'),
  );
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map((image) => image.decode()));
  });
  const source = await readFile(resolve(root, 'docs/user-manual-1.2.1.md'), 'utf8');
  assert.equal(await page.locator('.sheet').count(), source.split('<!-- page -->').length);
  assert.equal(await page.locator('img').count(), [...source.matchAll(/!\[/g)].length);
  assert.deepEqual(failures, []);
  assert.equal(
    await page
      .locator('img')
      .evaluateAll((images) => images.every((image) => image.complete && image.naturalWidth > 0)),
    true,
  );
  await page.emulateMedia({ media: 'print' });
  const measurements = await page.locator('.sheet').evaluateAll((sections) =>
    sections.map((section) => {
      if (section.getBoundingClientRect().height > 1008) section.classList.add('compact');
      return {
        title: section.querySelector('h1,h2').textContent,
        height: section.getBoundingClientRect().height,
        width: section.getBoundingClientRect().width,
      };
    }),
  );
  assert.deepEqual(
    measurements.filter((section) => section.height > 1008),
    [],
    'Some handbook sections exceed an A4 page',
  );
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    true,
  );
  // Keep an offline HTML with the exact print formatting used in the PDF.
  await writeFile(
    resolve(root, 'deliverables/user-manual-1.2.1.html'),
    '<!doctype html>\n' + (await page.locator('html').evaluate((element) => element.outerHTML)),
  );
  // PDF image links do not need to embed another copy of each PNG as a URL annotation.
  await page
    .locator('figure a')
    .evaluateAll((links) => links.forEach((link) => link.removeAttribute('href')));
  await page.pdf({
    path: resolve(root, 'deliverables/user-manual-1.2.1.pdf'),
    preferCSSPageSize: true,
    printBackground: true,
    displayHeaderFooter: false,
    tagged: true,
  });
  await mkdir(resolve(root, 'artifacts/user-manual'), { recursive: true });
  await writeFile(
    resolve(root, 'artifacts/user-manual/export-checks.json'),
    JSON.stringify(
      { sections: measurements, screenshots: 31, allImagesLoaded: true, offline: true },
      null,
      2,
    ),
  );
  await page.emulateMedia({ media: 'screen' });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    true,
    'Mobile handbook overflows',
  );
  console.log(
    `PDF and offline HTML ready: ${measurements.length} sections, 31 loaded screenshots; A4 and mobile overflow checks passed.`,
  );
} finally {
  await browser.close();
}

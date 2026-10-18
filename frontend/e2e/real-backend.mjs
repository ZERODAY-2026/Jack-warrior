// Drives the built app against a running backend in Chromium and prints what it saw.
// Usage: node e2e/real-backend.mjs http://127.0.0.1:8000 <fixtures-dir> <screenshot-dir>
// fixtures-dir needs rental_agreement.txt, injection_notice.txt and rental.pdf.
import { createRequire } from 'module';
// Uses a globally installed Playwright (npm i -g playwright) so it is not a project dependency.
const require = createRequire(process.env.PLAYWRIGHT_MODULE_DIR || import.meta.url);
const { chromium } = require('playwright');
const [,, BASE, FIX, S] = process.argv;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const log = [];
const problems = [];
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) problems.push(`console ${m.type()}: ${m.text()}`); });
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on('request', (r) => { if (!r.url().startsWith(BASE)) problems.push(`EXTERNAL ${r.url()}`); });
page.on('response', (r) => { if (r.url().includes('/api/')) log.push(`${r.request().method()} ${new URL(r.url()).pathname} -> ${r.status()}`); });

async function analyse(file) {
  await page.setInputFiles('[data-testid=file-input]', file);
  await page.getByRole('button', { name: /analyse document/i }).click();
  await page.locator('#document-heading').waitFor({ timeout: 120000 });
}
async function ask(q) {
  await page.getByRole('tab', { name: /ask a question/i }).click();
  await page.getByLabel(/ask about this document/i).fill(q);
  await page.getByRole('button', { name: /^ask$/i }).click();
  const item = page.locator('.qa').first();
  await item.locator('.qa__answer, .field-error').waitFor({ timeout: 120000 });
  return (await item.innerText()).replace(/\n+/g, ' | ');
}

await page.goto(BASE + '/');
await page.getByRole('button', { name: /model ready/i }).waitFor();
await analyse(`${FIX}/rental_agreement.txt`);
log.push('DOC BAR: ' + (await page.locator('.document-bar').innerText()).replace(/\n+/g, ' | '));
log.push('SUMMARY: ' + (await page.locator('.summary-text').innerText()));
await page.getByRole('tab', { name: /findings/i }).click();
const cards = page.locator('.finding-card');
const n = await cards.count();
log.push(`FINDINGS: ${n}`);
for (let i = 0; i < Math.min(n, 12); i++) log.push('  - ' + (await cards.nth(i).locator('.finding-card__title').innerText()) + ' [' + (await cards.nth(i).locator('.badge').first().innerText()) + '] ' + (await cards.nth(i).locator('.evidence-status').innerText()));
await cards.first().click();
await page.screenshot({ path: `${S}/e2e-findings.png`, fullPage: true });
const viewBtn = page.locator('.evidence-panel').getByRole('button', { name: /view in document/i }).first();
if (await viewBtn.count()) {
  await viewBtn.click();
  await page.locator('.source-text').waitFor();
  const marked = await page.locator('.source-text mark').count();
  log.push(`SOURCE VIEW: highlighted=${marked > 0} ${marked ? '"' + (await page.locator('.source-text mark').innerText()).slice(0, 80) + '"' : ''}`);
  await page.screenshot({ path: `${S}/e2e-source.png` });
  await page.keyboard.press('Escape');
}
// Check every passage with offsets is locatable
for (const q of ['What is the notice period?', 'Is this contract enforceable?', 'Is there a pet policy?', 'What happens if rent is paid late?']) {
  log.push(`ASK "${q}": ${await ask(q)}`);
}
await page.screenshot({ path: `${S}/e2e-ask.png`, fullPage: true });
await page.getByRole('button', { name: /remove document/i }).click();
await page.locator('.callout').filter({ hasText: /removed from this screen/ }).waitFor();
log.push('REMOVE: ' + (await page.locator('.callout').filter({ hasText: /removed/ }).innerText()));

// Prompt-injection fixture
await analyse(`${FIX}/injection_notice.txt`);
log.push('INJECTION DOC SUMMARY: ' + (await page.locator('.summary-text').innerText()));
const warns = await page.locator('.callout').allInnerTexts();
log.push('INJECTION DOC CALLOUTS: ' + warns.join(' || ').replace(/\n+/g, ' '));
await page.getByRole('button', { name: /remove document/i }).click();
await page.locator('.callout').filter({ hasText: /removed from this screen/ }).waitFor();

// PDF
await analyse(`${FIX}/rental.pdf`);
log.push('PDF DOC BAR: ' + (await page.locator('.document-bar').innerText()).replace(/\n+/g, ' | '));
await page.getByRole('tab', { name: /findings/i }).click();
await page.locator('.finding-card').first().click();
const pv = page.locator('.evidence-panel').getByRole('button', { name: /view in document/i }).first();
if (await pv.count()) {
  await pv.click();
  await page.locator('.source-text').waitFor();
  log.push(`PDF SOURCE VIEW: highlighted=${(await page.locator('.source-text mark').count()) > 0}, ${await page.locator('.dialog--wide .muted').first().innerText()}`);
  await page.keyboard.press('Escape');
}
// Bad file
await page.getByRole('button', { name: /remove document/i }).click();
await page.locator('.callout').filter({ hasText: /removed from this screen/ }).waitFor();
await page.setInputFiles('[data-testid=file-input]', { name: 'broken.pdf', mimeType: 'application/pdf', buffer: Buffer.from('not really a pdf') });
await page.getByRole('button', { name: /analyse document/i }).click();
await page.locator('.callout__title', { hasText: 'Analysis failed' }).waitFor();
log.push('BROKEN PDF: ' + (await page.locator('.callout--danger').innerText()).replace(/\n+/g, ' | '));
const storage = await page.evaluate(() => localStorage.length + sessionStorage.length);
log.push(`BROWSER STORAGE ENTRIES: ${storage}`);
await browser.close();
console.log(log.join('\n'));
console.log('\nPROBLEMS:\n' + (problems.length ? problems.join('\n') : 'none'));

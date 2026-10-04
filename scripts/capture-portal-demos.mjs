/**
 * Capture four fictional, looping portal demos and reduced-motion stills.
 * Run from this worktree: node scripts/capture-portal-demos.mjs
 * Prerequisites: Node 24, installed Playwright Chromium (npm run
 * test:browser:install), and the already-installed transitive sharp 0.35.2.
 * No dependencies are installed. Outputs: public/portal/media/*.webp only;
 * capture-report.json, review contact sheets and the synthetic source cover,
 * floor plan and CSV go to the ignored .wrangler/portal-demo-capture/.
 *
 * Owns an isolated server on 127.0.0.1:8788; refuses an occupied port. Builds
 * the sample fixture using the browser harness recipe, clears ONLY
 * .wrangler/local-portal before capture, then disposes its D1/R2 data through
 * the existing local-only mail-sink DELETE endpoint before stopping its process
 * tree in finally. This avoids Windows directory locks during process exit.
 * Build/staging and Wrangler create their normal ignored runtime artifacts.
 * Discovery-page generation is intentionally omitted: /portal/ requires these
 * very assets, so generating it before capture would create a build cycle.
 * The Reader SPA and portal bundles do not need those static discovery pages.
 * Never run concurrently with another local portal or browser test harness.
 * One Windows EADDRINUSE startup failure is retried once.
 *
 * Uses real mail-sink login, claim approval, override, candidate/onboarding,
 * CSV import and map APIs. Uses the same UI patterns as tests/browser.
 * This server alone advertises https://portal-pictures.test for uploaded R2
 * catalog objects: local HTTP otherwise fails the editor's HTTPS rule.
 * Playwright fulfills those URLs with the generated uploaded cover bytes;
 * no remote images, mail, publication, or production data are involved.
 * Capture-only CSS hides the account banner/Turnstile and a small cursor/ripple
 * explains actual clicks. It does not replace UI state or app behavior.
 * Fixed 1200x750 DPR1 viewport/crop; output 960x600. Step screenshots have
 * explicit delays (including a final 1500ms pause); animated WebP loop=0.
 * Encoding verifies dimensions, duration, loop and <=600000 bytes and falls
 * back to lower quality if necessary. --only=NAME aids capture iteration;
 * the default always captures all four clips. No commits are made.
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import { localPortalWranglerArgs, readLocalPortalEnvironment } from './local-portal-environment.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
assert.equal(path.resolve(process.cwd()), path.resolve(ROOT), 'Run from this worktree, not the main checkout.');
const MEDIA = path.join(ROOT, 'public/portal/media');
// Everything that is not a published demo stays out of public/, which deploys.
const REVIEW = path.join(ROOT, '.wrangler/portal-demo-capture');
const RUNTIME = path.join(REVIEW, '.capture-runtime');
const LOCAL = path.resolve(ROOT, '.wrangler/local-portal');
assert.ok(LOCAL.startsWith(`${path.resolve(ROOT)}${path.sep}`));
const ORIGIN = 'http://127.0.0.1:8788';
process.env.MAP_TEST_URL = ORIGIN;
const require = createRequire(import.meta.url);
let sharp, chromium;
try { sharp = (await import('sharp')).default; }
catch { console.error('Cannot import the installed transitive sharp. Restore the existing npm install; this script does not add dependencies.'); process.exit(2); }
try { ({ chromium } = await import('playwright')); }
catch { console.error('Playwright is missing. Restore the existing npm install and run npm run test:browser:install.'); process.exit(2); }
const { loginLink, ADMIN, CIRCLE, clearMail } = await import('../tests/browser/support/portal.mjs');
const config = await readLocalPortalEnvironment();
const only = process.argv.find(arg => arg.startsWith('--only='))?.slice(7);
const names = ['circle-map-card', 'circle-editor', 'organizer-import', 'organizer-map'];
if (only && !names.includes(only)) throw new Error(`Unknown clip: ${only}`);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let server, browser, lastPage, serverLog = '';
const report = { source: 'fictional local sample; real UI and local APIs', sharp: sharp.versions.sharp, clips: [] };

function run(script, args = []) {
  const result = spawnSync(process.execPath, [script, ...args], { cwd: ROOT, stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`${path.basename(script)} failed: ${result.stderr?.slice(-3000)}`);
}
function killTree(child) {
  if (!child?.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    // Native taskkill is denied by some workspace-write sandboxes. PowerShell's
    // Process.Parent uses Windows process metadata without requiring WMI/CIM.
    // Resolve only descendants of this launcher, then stop them child-first.
    assert.ok(Number.isSafeInteger(child.pid));
    const command = `function Get-CaptureTree([int]$capturePid) { $capturePid; $captureChildren = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { try { $_.Parent.Id -eq $capturePid } catch { $false } }); foreach ($captureChild in $captureChildren) { Get-CaptureTree $captureChild.Id } }; $captureOwned = @(Get-CaptureTree ${child.pid}); Stop-Process -Id $captureOwned -Force -ErrorAction SilentlyContinue`;
    const stopped = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', command], { stdio: 'pipe', encoding: 'utf8', windowsHide: true, timeout: 15000 });
    if (stopped.status !== 0) throw new Error(`Could not stop capture server tree: ${stopped.stderr || stopped.error}`);
  }
  else { try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill(); } }
}
async function clearLocal() {
  for (let attempt = 0; ; attempt++) {
    try { await rm(LOCAL, { recursive: true, force: true }); return; }
    catch (error) { if (attempt === 40) throw error; await sleep(500); }
  }
}
async function startServer() {
  await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', () => reject(new Error('Port 8788 is occupied. Stop the existing local portal before capturing.')));
    probe.listen(8788, '127.0.0.1', () => probe.close(resolve));
  });
  console.log('Building fictional sample portal…');
  run(path.join(ROOT, 'scripts/stage-event-data.mjs'), ['--fixture', 'sample']);
  const viteManifest = require.resolve('vite/package.json');
  const vite = JSON.parse(await readFile(viteManifest, 'utf8')).bin.vite;
  run(path.resolve(path.dirname(viteManifest), vite), ['build', '--config', 'vite.pages.config.ts']);
  for (const script of ['build-service-worker.mjs', 'build-privacy-page.mjs']) run(path.join(ROOT, 'scripts', script));
  await clearLocal();
  const manifest = require.resolve('wrangler/package.json');
  const bin = JSON.parse(await readFile(manifest, 'utf8')).bin.wrangler;
  for (let attempt = 0; attempt < 2; attempt++) {
    serverLog = '';
    server = spawn(process.execPath, [path.resolve(path.dirname(manifest), bin), ...localPortalWranglerArgs({ ...config, THUMBNAIL_PUBLIC_ORIGIN: 'https://portal-pictures.test' })], { cwd: ROOT, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env: { ...process.env, XDG_CONFIG_HOME: RUNTIME, WRANGLER_LOG_PATH: path.join(RUNTIME, 'logs'), WRANGLER_SEND_METRICS: 'false', CI: '1' } });
    server.stdout.on('data', data => { serverLog = (serverLog + data).slice(-12000); });
    server.stderr.on('data', data => { serverLog = (serverLog + data).slice(-12000); });
    for (let wait = 0; wait < 180; wait++) {
      try { const response = await fetch(`${ORIGIN}/api/auth/config`, { signal: AbortSignal.timeout(1000) }); if (response.ok) return; } catch { /* starting */ }
      if (server.exitCode !== null || /EADDRINUSE/.test(serverLog)) break;
      await sleep(500);
    }
    killTree(server);
    if (attempt === 0 && /EADDRINUSE/.test(serverLog)) { console.log('Retrying Windows port collision once…'); await sleep(1500); continue; }
    throw new Error(`Portal did not start: ${serverLog.slice(-3000)}`);
  }
}
async function api(page, pathname, method = 'GET', body) {
  return page.evaluate(async ({ pathname, method, body }) => {
    const response = await fetch(pathname, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const value = await response.json();
    if (!response.ok) throw new Error(`${method} ${pathname}: ${response.status} ${JSON.stringify(value)}`);
    return value;
  }, { pathname, method, body });
}
async function newPage(email, audience, options = {}) {
  const context = await browser.newContext({ viewport: { width: 1200, height: 750 }, deviceScaleFactor: 1, serviceWorkers: 'block' });
  const page = await context.newPage(); lastPage = page; page.setDefaultTimeout(15000);
  await page.goto(await loginLink(email, audience, options));
  await page.getByRole('button', { name: /^(帳號|登出)$/ }).first().waitFor();
  return page;
}
async function safeCaptureSurface(page) {
  await page.addStyleTag({ content: `
    #demo-cursor { position:fixed; z-index:2147483647; pointer-events:none; width:22px; height:28px; }
    #demo-ripple {position:fixed; z-index:2147483646; pointer-events:none; width:38px; height:38px; border:3px solid #ed7958; border-radius:50%; background:#ed79582b; display:none;}
    [role=banner], body header:not(main header):has(button), iframe[src*="challenges.cloudflare.com"], .cf-turnstile { display:none !important; }
    * { caret-color:transparent !important; } html {scroll-behavior:auto !important;}
  ` });
  // Actual portal banners have <header>, hence implicit banner semantics.
  await page.getByRole('banner').evaluateAll(nodes => nodes.forEach(node => node.style.display = 'none'));
  await page.evaluate(() => {
    document.querySelector('#demo-cursor')?.remove(); document.querySelector('#demo-ripple')?.remove();
    const cursor = document.createElement('div'); cursor.id = 'demo-cursor'; cursor.style.cssText = 'left:1120px;top:650px';
    cursor.innerHTML = '<svg width="22" height="28" viewBox="0 0 22 28"><path d="M2 2L2 23L7 18L11 26L15 24L11 16L19 16Z" fill="#263b37" stroke="white" stroke-width="2"/></svg>';
    const ripple = document.createElement('div'); ripple.id = 'demo-ripple'; document.body.append(cursor, ripple);
    // Only privacy surfaces; do not remove validation, progress, or results.
    for (const node of document.querySelectorAll('small,p,span')) {
      if (node.children.length === 0 && /登入有效期限|登入期限|登入到期|local-(?:admin|circle)@example\.test/.test(node.textContent)) node.style.visibility = 'hidden';
    }
  });
}
async function cursor(page, x, y, ripple = false) {
  await page.mouse.move(x, y);
  await page.evaluate(({ x, y, ripple }) => {
    const host = document.querySelector('dialog:modal') ?? document.body;
    for (const id of ['demo-cursor', 'demo-ripple']) {
      const overlay = document.getElementById(id); if (overlay.parentElement !== host) host.append(overlay);
    }
    const node = document.querySelector('#demo-cursor'); node.style.left = `${x}px`; node.style.top = `${y}px`;
    const ring = document.querySelector('#demo-ripple'); ring.style.left = `${x - 19}px`; ring.style.top = `${y - 19}px`; ring.style.display = ripple ? 'block' : 'none';
  }, { x, y, ripple });
}
function capture(page) {
  const frames = [], delays = [];
  const shot = async (delay = 700) => {
    const forbidden = await page.evaluate(() => {
      const visible = element => { const rect = element.getBoundingClientRect(), css = getComputedStyle(element); return rect.width && rect.height && rect.top < 750 && rect.bottom > 0 && css.visibility !== 'hidden' && css.display !== 'none'; };
      return [...document.querySelectorAll('body *')].filter(node => node.children.length === 0 && visible(node) && /[\w.+-]+@[\w.-]+|登入有效期限|登入期限|登入到期|Turnstile|^帳號$|^登出$/.test(node.textContent)).map(node => node.textContent);
    });
    assert.deepEqual(forbidden, [], 'Private account/session or Turnstile text visible');
    // A modal opened since the last move (the full-window map editor) sits in
    // the top layer above the body, so the overlay follows it in before each frame.
    await page.evaluate(() => {
      const host = document.querySelector('dialog:modal') ?? document.body;
      for (const id of ['demo-cursor', 'demo-ripple']) { const overlay = document.getElementById(id); if (overlay && overlay.parentElement !== host) host.append(overlay); }
    });
    frames.push(await page.screenshot({ clip: { x: 0, y: 0, width: 1200, height: 750 } })); delays.push(delay);
  };
  const click = async (locator, delay = 650) => {
    await locator.scrollIntoViewIfNeeded();
    const box = await locator.boundingBox(); assert.ok(box);
    await cursor(page, box.x + box.width / 2, box.y + box.height / 2); await shot(250);
    await cursor(page, box.x + box.width / 2, box.y + box.height / 2, true); await locator.click(); await sleep(200); await shot(delay);
    await page.evaluate(() => { document.querySelector('#demo-ripple').style.display = 'none'; });
  };
  return { frames, delays, shot, click };
}
async function encode(name, clip) {
  const resized = await Promise.all(clip.frames.map(frame => sharp(frame).resize({ width: 960 }).png().toBuffer()));
  let animation;
  for (const quality of [70, 58, 46, 36]) {
    animation = await sharp(resized, { join: { animated: true } }).webp({ loop: 0, delay: clip.delays, quality, effort: 6 }).toBuffer();
    if (animation.length <= 600000) break;
  }
  assert.ok(animation.length <= 600000, `${name} exceeds 600KB`);
  const still = await sharp(resized.at(-1)).webp({ quality: 78, effort: 6 }).toBuffer();
  const metadata = await sharp(animation, { animated: true }).metadata();
  const duration = metadata.delay.reduce((sum, delay) => sum + delay, 0);
  assert.equal(metadata.width, 960); assert.equal(metadata.pageHeight, 600); assert.equal(metadata.loop, 0);
  assert.equal(duration, clip.delays.reduce((sum, delay) => sum + delay, 0));
  assert.ok(duration >= 5000 && duration <= 9000, `${name} duration ${duration}`);
  await writeFile(path.join(MEDIA, `${name}.webp`), animation);
  await writeFile(path.join(MEDIA, `${name}-still.webp`), still);
  // Contact sheet is useful for repeatable visual review of actions and privacy.
  const selected = [...new Set([0, Math.floor(resized.length / 2), resized.length - 1])];
  await sharp(await Promise.all(selected.map(i => sharp(resized[i]).resize(480).toBuffer())), { join: { across: 3 } }).png().toFile(path.join(REVIEW, `${name}-review.png`));
  const result = { name, animatedKB: +(animation.length / 1000).toFixed(1), stillKB: +(still.length / 1000).toFixed(1), width: metadata.width, height: metadata.pageHeight, durationMs: duration, loop: metadata.loop, frameDelaysMs: metadata.delay, finalPauseMs: clip.delays.at(-1) };
  report.clips.push(result); console.log(JSON.stringify(result));
}
async function assets() {
  const cover = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1000"><rect width="800" height="1000" fill="#f7eedc"/><rect x="55" y="55" width="690" height="890" rx="18" fill="#d8e8df"/><circle cx="400" cy="365" r="170" fill="#739a88"/><path d="M160 465Q320 235 400 455Q520 290 655 500V620H160Z" fill="#f7eedc"/><circle cx="520" cy="260" r="40" fill="#f4ba74"/><text x="400" y="738" text-anchor="middle" font-family="sans-serif" font-size="65" fill="#2c493d">FOREST LETTERS</text><text x="400" y="815" text-anchor="middle" font-family="sans-serif" font-size="28" fill="#2c493d">FICTIONAL ART BOOK · VOL. 01</text><text x="400" y="865" text-anchor="middle" font-family="sans-serif" font-size="26" fill="#2c493d">A5 / 24 pages</text></svg>`);
  const coverPng = await sharp(cover).png().toBuffer(); await writeFile(path.join(REVIEW, 'fictional-catalog.png'), coverPng);
  const plan = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="620"><rect width="1000" height="620" fill="#f7f6f0"/><rect x="45" y="45" width="910" height="530" rx="8" fill="#fff" stroke="#8d9c94" stroke-width="8"/><path d="M65 150H935M65 495H935" stroke="#e4e9e5" stroke-width="3"/><rect x="385" y="55" width="230" height="70" rx="8" fill="#e5ede8"/><text x="500" y="100" text-anchor="middle" font-family="sans-serif" font-size="28" fill="#647d70">STAGE</text><rect x="445" y="565" width="110" height="30" fill="#f7f6f0"/><text x="500" y="535" text-anchor="middle" font-family="sans-serif" font-size="22" fill="#647d70">ENTRANCE</text></svg>`);
  const planPng = await sharp(plan).resize(600, 372).png().toBuffer(); await writeFile(path.join(REVIEW, 'fictional-floor-plan.png'), planPng);
  const csv = '攤位代碼,社團名稱\nA01,森林來信\nA02,星砂手帖\nA03,小島故事\nA04,月光紙屋\n';
  await writeFile(path.join(REVIEW, 'fictional-booths.csv'), csv);
  return { coverPng, planPng, csv };
}
async function seedCircle(admin, source) {
  console.log('Seeding verified claim and circle-owned catalog upload…');
  const page = await newPage(CIRCLE, 'circle', { event: 'sample', circleId: 'c-900001' });
  await page.getByRole('button', { name: '送出認領', exact: true }).click();
  await page.getByRole('button', { name: '撤回', exact: true }).waitFor();
  const queue = await api(admin, '/api/admin/review-queue');
  const claim = queue.claims.find(item => item.circleId === 'c-900001'); assert.ok(claim);
  await api(admin, '/api/admin/claims?event=sample', 'POST', { claimId: claim.id, decision: 'approve' });
  await page.reload(); await page.locator('textarea[id^="sale-"]').waitFor();
  await page.waitForFunction(() => !document.querySelector('textarea[id^="sale-"]').disabled);
  // Upload through the same age-gated UI as the existing circle journey.
  await page.route('https://portal-pictures.test/**', route => route.fulfill({ contentType: 'image/png', body: source.coverPng }));
  await page.getByRole('checkbox', { name: '我確認這些圖片適合所有年齡的讀者觀看。' }).check();
  const uploaded = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/catalog-image') && response.request().method() === 'POST');
  await page.getByLabel('新增品書圖片', { exact: true }).setInputFiles({ name: 'fictional-catalog.png', mimeType: 'image/png', buffer: source.coverPng });
  const uploadResponse = await uploaded; assert.equal(uploadResponse.status(), 200); const { image } = await uploadResponse.json();
  const fields = { saleInfo: '原創插畫集《森林來信》\nA5・24 頁｜現場另有明信片小組。', pen: '森頁（示範筆名）', circleCategory: '原創作品', specialTags: ['原創插畫', '紙品'], ageRatings: ['全年齡'], links: [{ provider: '作品頁', kind: 'website', url: 'https://example.test/forest-letters' }], catalogImages: [image] };
  await api(page, '/api/circle/c-900001/overrides?event=sample', 'PUT', { fields });
  await page.evaluate(() => localStorage.clear());
  await page.reload(); await page.waitForFunction(() => document.querySelector('textarea[id^="sale-"]')?.value.includes('森林來信'));
  return page;
}
async function circleEditor(page) {
  console.log('Capturing circle-editor…'); await safeCaptureSurface(page);
  // Ticked the way a circle would before saving, so the clip does not open on
  // the unconfirmed-images prompt.
  await page.getByRole('checkbox', { name: '我確認這些圖片適合所有年齡的讀者觀看。' }).check();
  const field = page.locator('textarea[id^="sale-"]'); await field.scrollIntoViewIfNeeded();
  await page.evaluate(() => { const top = document.querySelector('[id^="circle-editor-"]').getBoundingClientRect().top + scrollY; scrollTo(0, top - 12); });
  const clip = capture(page); await clip.shot(1000);
  const box = await field.boundingBox(); await cursor(page, box.x + 100, box.y + 35, true); await field.click(); await clip.shot(350);
  const lines = ['原創插畫集《森林來信》', 'A5・24 頁｜附贈一張森林書籤。', '新作明信片組，歡迎來攤位翻閱！'];
  await field.fill('');
  for (let i = 0; i < lines.length; i++) { await field.fill(lines.slice(0, i + 1).join('\n')); await sleep(350); await clip.shot(550); }
  await clip.click(page.getByRole('button', { name: '預覽並送出', exact: true }), 850);
  const confirm = page.getByRole('button', { name: '確認儲存', exact: true }); await confirm.waitFor(); await clip.shot(700);
  await clip.click(confirm, 600);
  await page.getByText('已儲存，公開頁面會在一分鐘內更新。', { exact: false }).waitFor();
  await clip.shot(1500); await encode('circle-editor', clip);
}
async function circleMap(page) {
  console.log('Capturing circle-map-card…');
  await page.goto(`${ORIGIN}/?event=sample`); await page.locator('[data-slot-code]').first().waitFor();
  await safeCaptureSurface(page); await sleep(500);
  const clip = capture(page); await clip.shot(1200);
  const circleLink = page.getByRole('link', { name: /北風畫室/ }).first();
  // Reader selection is a real list link, then a real map focus and card.
  await clip.click(circleLink, 650);
  await page.getByText('森頁（示範筆名）', { exact: false }).first().waitFor(); await sleep(400); await clip.shot(1000);
  const booth = page.locator('[data-slot-code="S01"]').first(); const box = await booth.boundingBox();
  await cursor(page, box.x + box.width / 2, box.y + box.height / 2); await clip.shot(850);
  await cursor(page, 980, 370); await clip.shot(850); await clip.shot(1500);
  await encode('circle-map-card', clip);
}
async function seedCandidate(admin) {
  console.log('Seeding organizer candidate with completed onboarding…');
  const created = await api(admin, '/api/admin/organizer/events', 'POST', { tentativeName: '秋日創作交流會（示範）', ownerEmail: ADMIN });
  const id = created.candidateId;
  const detail = await api(admin, `/api/organizer/events/${id}`);
  const organizer = await api(admin, `/api/organizer/events/${id}/references`, 'POST', { expectedVersion: detail.event.version, kind: 'organizer', name: '範例創作交流組', sourceUrl: 'https://example.test/autumn' });
  const afterOrganizer = await api(admin, `/api/organizer/events/${id}`);
  const category = await api(admin, `/api/organizer/events/${id}/references`, 'POST', { expectedVersion: afterOrganizer.event.version, kind: 'category-catalog', name: '示範創作主題', sourceUrl: 'https://example.test/categories', organizerId: organizer.created.id, categories: [{ label: '原創作品', description: '虛構示範創作。' }] });
  const venue = await api(admin, `/api/organizer/events/${id}/venues`, 'POST', { name: '創作交流中心（示範）', sourceUrl: 'https://example.test/venue', address: '範例市創作路一號', initialSpace: { name: '交流廳', sourceUrl: null, defaultAreaMode: 'none' } });
  const draft = { ...detail.draft, event: { id: 'portal-demo', name: '秋日創作交流會（示範）', days: [{ id: '1', label: '活動日', date: '2026-11-07' }] }, venue: { assignments: [{ venueId: venue.venue.id, venueSpaceId: venue.space.id, areaIds: ['ALL'], areaMode: 'none', mapTemplate: 'TAIWAN_GENERIC_V1' }] }, officialSource: { label: '示範活動資料', url: 'https://example.test/autumn' }, references: { organizerAssignments: [{ organizerId: organizer.created.id, role: 'lead' }], categoryCatalog: { id: category.created.id, organizerId: organizer.created.id, revision: category.created.revision } } };
  const latest = await api(admin, `/api/organizer/events/${id}`);
  const saved = await api(admin, `/api/organizer/events/${id}`, 'PATCH', { expectedVersion: latest.event.version, draft });
  await api(admin, `/api/organizer/events/${id}/workspace/complete-onboarding`, 'POST', { expectedVersion: saved.version });
  await api(admin, `/api/organizer/events/${id}/workspace`, 'PATCH', { guidedTask: 'identity_source', lastSection: 'import' });
  lastPage = admin;
  await admin.goto(`${ORIGIN}/organizer?candidate=${id}`); await admin.getByRole('heading', { name: /秋日創作交流會/ }).waitFor();
  return id;
}
async function organizerImport(page, source, record = true) {
  console.log('Importing fictional organizer CSV…'); await safeCaptureSurface(page);
  if (await page.getByRole('button', { name: '匯入檔案', exact: true }).count()) await page.getByRole('button', { name: '匯入檔案', exact: true }).click();
  const clip = capture(page); await clip.shot(900);
  const input = page.getByLabel('來源檔案', { exact: true });
  const inputBox = await input.boundingBox(); await cursor(page, inputBox.x + 75, inputBox.y + 15, true);
  await input.setInputFiles({ name: 'fictional-booths.csv', mimeType: 'text/csv', buffer: Buffer.from(source.csv) }); await sleep(250); await clip.shot(750);
  await clip.click(page.getByRole('button', { name: '下一步：欄位對照', exact: true }), 550);
  const form = page.getByRole('group', { name: '匯入檔案與欄位對應', exact: true });
  await form.getByLabel('攤位代碼', { exact: true }).selectOption('0');
  await form.getByLabel('社團名稱', { exact: true }).selectOption('1'); await clip.shot(650);
  await clip.click(form.getByRole('button', { name: '預覽對應結果', exact: true }), 900);
  await clip.shot(850);
  await clip.click(form.getByRole('button', { name: '匯入名單', exact: true }), 550);
  await page.getByRole('region', { name: '攤位名單', exact: true }).waitFor(); await clip.shot(1500);
  if (record) await encode('organizer-import', clip);
}
async function organizerMap(page, source) {
  console.log('Capturing organizer-map…');
  await page.locator('summary').filter({ hasText: '準備進度' }).click();
  await page.getByRole('group', { name: '活動項目', exact: true }).getByRole('button', { name: /地圖/ }).click();
  await page.getByRole('button', { name: '建立這張地圖', exact: true }).click();
  const editor = page.getByRole('region', { name: '活動地圖編輯器' }); await editor.waitFor();
  await safeCaptureSurface(page);
  const clip = capture(page); await clip.shot(650);
  await page.locator('input[type="file"]').setInputFiles({ name: 'fictional-floor-plan.png', mimeType: 'image/png', buffer: source.planPng });
  const crop = page.getByRole('dialog', { name: '框選目前場地', exact: true }); await crop.waitFor(); await clip.shot(850);
  await clip.click(crop.getByRole('button', { name: '使用整張圖', exact: true }), 650);
  await clip.click(page.getByRole('button', { name: /^(開啟|展開)全視窗$/ }), 350); await sleep(350);
  await editor.getByRole('button', { name: '底圖與畫布', exact: true }).click();
  const opacity = editor.getByRole('slider', { name: '配置圖透明度' });
  await opacity.fill('80');
  const group = editor.getByRole('button', { name: '攤位', exact: true }); if (await group.getAttribute('aria-expanded') !== 'true') await group.click();
  await editor.getByRole('button', { name: '新增排／排段', exact: true }).click();
  await editor.getByRole('textbox', { name: '排標籤', exact: true }).fill('A');
  await editor.getByRole('textbox', { name: '結束編號', exact: true }).fill('4');
  const svg = editor.locator("svg[tabindex='0']"); await svg.scrollIntoViewIfNeeded(); const bounds = await svg.boundingBox();
  const from = { x: bounds.x + bounds.width * .25, y: bounds.y + bounds.height * .4 };
  const to = { x: bounds.x + bounds.width * .65, y: bounds.y + bounds.height * .52 };
  await cursor(page, from.x, from.y); await clip.shot(450); await page.mouse.down();
  for (let i = 1; i <= 5; i++) { await cursor(page, from.x + (to.x - from.x) * i / 5, from.y + (to.y - from.y) * i / 5, true); await clip.shot(150); }
  await page.mouse.up(); await clip.shot(750); await page.keyboard.press('Escape');
  await editor.getByRole('combobox', { name: '選取地圖元素' }).selectOption('');
  assert.ok(await svg.locator('[data-slot-code]').count() >= 4, 'Actual drawn booths must exist');
  await clip.click(page.getByRole('button', { name: '建立這個活動日與場地的地圖', exact: true }), 650);
  await page.getByText('地圖已儲存，尚未公開。', { exact: true }).waitFor(); await clip.shot(1500);
  await encode('organizer-map', clip);
}
try {
  await mkdir(MEDIA, { recursive: true });
  await mkdir(REVIEW, { recursive: true });
  // Verify installed sharp's array-join animation API before starting a server.
  const pixels = await Promise.all(['red', 'blue'].map(background => sharp({ create: { width: 2, height: 2, channels: 3, background } }).png().toBuffer()));
  const probe = await sharp(pixels, { join: { animated: true } }).webp({ loop: 0, delay: [250, 1500] }).toBuffer();
  const probeMeta = await sharp(probe, { animated: true }).metadata(); assert.equal(probeMeta.pages, 2); assert.deepEqual(probeMeta.delay, [250, 1500]);
  const source = await assets(); await startServer();
  try { browser = await chromium.launch({ headless: true }); }
  catch (error) { throw new Error(`Chromium could not launch. Run npm run test:browser:install. ${error.message}`); }
  await clearMail(); const admin = await newPage(ADMIN, 'organizer');
  if (!only || only.startsWith('circle-')) {
    const circle = await seedCircle(admin, source);
    if (!only || only === 'circle-editor') await circleEditor(circle);
    if (!only || only === 'circle-map-card') await circleMap(circle);
  }
  if (!only || only.startsWith('organizer-')) {
    await seedCandidate(admin); await organizerImport(admin, source, !only || only === 'organizer-import');
    if (!only || only === 'organizer-map') await organizerMap(admin, source);
  }
  await writeFile(path.join(REVIEW, 'capture-report.json'), JSON.stringify(report, null, 2) + '\n');
  await rm(path.join(REVIEW, 'capture-error.png'), { force: true });
} catch (error) {
  if (lastPage && !lastPage.isClosed()) {
    await safeCaptureSurface(lastPage).catch(() => {});
    await lastPage.screenshot({ path: path.join(REVIEW, 'capture-error.png') }).catch(() => {});
    console.error((await lastPage.locator('body').innerText().catch(() => '')).replace(/[\w.+-]+@[\w.-]+/g, '[account]').slice(-7000));
  }
  console.error(error); process.exitCode = 1;
} finally {
  // This endpoint already deletes all disposable local D1 rows and both R2
  // buckets. Never call it on an existing/caller-owned server.
  // Failures here are reported, not thrown: a throw would hide the capture's own error.
  const fail = (message) => { console.error(message); process.exitCode = 1; };
  if (server && server.exitCode === null) {
    const reset = await clearMail().catch((error) => ({ ok: false, status: error.message }));
    if (!reset.ok) fail(`Local test-data disposal failed: ${reset.status}`);
  }
  await browser?.close(); killTree(server); await sleep(750);
  await rm(RUNTIME, { recursive: true, force: true });
  if (server) {
    const listening = await fetch(`${ORIGIN}/api/auth/config`, { signal: AbortSignal.timeout(1000) }).then(() => true, () => false);
    if (listening) fail('Capture server still listening after shutdown');
    else console.log('Capture server stopped; isolated local portal data cleaned.');
  }
}

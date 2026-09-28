// staged-data: fixture
// Real admin UI and transport; authorization and atomicity run against D1 in organizer-handlers.
import assert from 'node:assert/strict';
import { start, base } from './support/journey.mjs';
const journey = await start('admin-shared-references');
let reads = 0, writes = [], failRead = false, conflict = false;
let catalog = { organizers: [], categories: [], venues: [{ id: 'unused', name: '未被活動使用的場館', sourceUrl: 'https://venue.example/', publicName: '未被活動使用的場館', address: null, officialUrl: 'https://venue.example/', version: 'v1', spaces: [{ id: 'hall', venueId: 'unused', name: '全館', defaultAreaMode: 'none', sourceUrl: 'https://venue.example/', officialUrl: 'https://venue.example/', publicName: '全館', version: 'v1', address: null }] }] };
const page = await journey.page({ url: `${base}/admin?section=references`, routes: async page => {
  await page.route('**/api/**', async route => {
    const req = route.request(), path = new URL(req.url()).pathname;
    const reply = (value, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
    if (path === '/api/auth/session') return reply({ email: 'admin@example.test', isAdmin: true, expiresAt: Date.now()+86400000 });
    assert.equal(path, '/api/admin/references', 'shared management does not load event-scoped management data');
    if (req.method() === 'GET') { reads++; return failRead ? reply({ error: '清單讀取失敗' }, 503) : reply(catalog); }
    const body = req.postDataJSON(); writes.push(body);
    assert.equal(body.candidateId, undefined);
    if (conflict) return reply({ error: '場館資料已變更，請重新讀取後核對。' }, 409);
    if (body.kind === 'venue-address') { catalog.venues[0].address = body.address; catalog.venues[0].version = 'v2'; }
    if (body.kind === 'organizer') catalog.organizers.push({ id: 'org', name: body.name, officialUrl: body.sourceUrl });
    if (body.kind === 'category-catalog') catalog.categories.push({ id: 'cat', organizerId: body.organizerId, revision: '1', name: body.name, sourceUrl: body.sourceUrl, categories: body.categories.map((item,i)=>({...item,id:`cat-${i}`})) });
    return reply({ ok: true, id: 'unused' }, 201);
  });
} });
try {
  await page.getByRole('heading', { name: '共用資料', exact: true }).waitFor();
  await page.getByRole('button', { name: '未被活動使用的場館', exact: true }).click();
  await page.getByRole('button', { name: '補上地址', exact: true }).click();
  await page.getByLabel('場館地址', { exact: true }).fill('台北市中山區玉門街1號');
  conflict = true;
  await page.getByRole('button', { name: '儲存地址', exact: true }).click();
  await page.getByRole('alert').getByText('場館資料已變更，請重新讀取後核對。', { exact: false }).waitFor();
  assert.equal(await page.getByLabel('場館地址', { exact: true }).inputValue(), '台北市中山區玉門街1號');
  conflict = false; failRead = true;
  await page.getByRole('button', { name: '儲存地址', exact: true }).click();
  await page.getByText('共用資料已儲存。', { exact: true }).waitFor();
  await page.getByText('資料已儲存，清單更新失敗。請重新讀取。', { exact: false }).waitFor();
  assert.equal(await page.getByRole('button', { name: '新增場館', exact: true }).isEnabled(), false);
  const written = writes.length;
  failRead = false;
  await page.getByRole('button', { name: '重新讀取', exact: true }).click();
  await page.getByText('地址：台北市中山區玉門街1號', { exact: true }).waitFor();
  assert.equal(writes.length, written, 'refresh retries GET, never repeats a successful write');
  assert.equal(await page.getByRole('button', { name: '補上地址', exact: true }).count(), 0);
  await journey.capture(page, 'shared-address-saved');
  await page.getByRole('button', { name: '主辦單位', exact: true }).click();
  await page.getByRole('button', { name: '新增主辦單位', exact: true }).click();
  await page.getByLabel('主辦名稱', { exact: true }).fill('測試主辦');
  await page.getByLabel('官方來源網址', { exact: true }).fill('https://organizer.example/');
  await page.getByRole('button', { name: '儲存', exact: true }).click();
  await page.getByText('測試主辦', { exact: true }).waitFor();
  await page.getByRole('button', { name: '分類目錄', exact: true }).click();
  await page.getByRole('button', { name: '新增分類目錄', exact: true }).click();
  await page.getByLabel('目錄名稱', { exact: true }).fill('第一版分類');
  await page.getByLabel('官方來源網址', { exact: true }).fill('https://organizer.example/categories');
  await page.getByRole('combobox', { name: /^所屬主辦/ }).selectOption('org');
  await page.getByLabel('分類名稱（每行一個）', { exact: true }).fill('原創\n二創');
  await page.getByRole('button', { name: '儲存', exact: true }).click();
  await page.getByText('第一版分類', { exact: true }).waitFor();
  await page.setViewportSize({ width: 375, height: 812 });
  await page.getByRole('button', { name: '場館與場地', exact: true }).click();
  await page.getByRole('button', { name: '未被活動使用的場館', exact: true }).click();
  await page.getByLabel('只看缺少地址', { exact: true }).check();
  await page.getByText('沒有符合的場館。', { exact: true }).waitFor();
  await page.getByLabel('只看缺少地址', { exact: true }).uncheck();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth <= window.innerWidth), 'mobile has no horizontal overflow');
  await journey.capture(page, 'shared-mobile');
  assert.ok(reads >= 4);
  await journey.finish();
} catch (error) { await journey.abort(error); }

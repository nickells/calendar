const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');

module.exports = async function testWorkerUpdate(browser) {
  let legacy = true;
  const root = path.resolve(__dirname, '..');
  const server = http.createServer(async (request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (pathname === '/sw.js' && legacy) {
      response.setHeader('Content-Type', 'text/javascript');
      response.end(`
        self.addEventListener('install', e => e.waitUntil(caches.open('calendar-shell-v1').then(c => c.put('./', new Response('<h1>Old build</h1>', {headers: {'Content-Type':'text/html'}})))));
        self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
        self.addEventListener('fetch', e => e.respondWith(caches.match(e.request).then(r => r || fetch(e.request))));
      `);
      return;
    }
    try {
      const file = path.join(root, pathname === '/' ? 'index.html' : pathname);
      const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' };
      response.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
      response.end(await fs.readFile(file));
    } catch { response.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.waitForFunction(() => navigator.serviceWorker.controller);
    await page.evaluate(async () => {
      const { saveEvent } = await import('./storage.mjs');
      await saveEvent({ id: 'persisted', title: 'Keep this event', date: '2026-09-16', allDay: true, start: '', end: '' });
    });
    await page.reload();
    assert.equal(await page.locator('h1').textContent(), 'Old build');
    legacy = false;
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
    await page.waitForSelector('.day-heading');
    assert.equal(await page.locator('#event-notes, .brand, #help, #event-count').count(), 0);
    assert.equal(await page.evaluate(async () => {
      const { loadEvents } = await import('./storage.mjs');
      return (await loadEvents())[0].title;
    }), 'Keep this event');
    assert.ok(!(await page.evaluate(() => caches.keys())).includes('calendar-shell-v1'));
    await context.setOffline(true);
    await page.reload();
    await page.waitForSelector('.day-heading');
    console.log('PASS: existing cached v1 tab updates in place to current UI, IndexedDB survives, updated app reloads offline.');
  } finally {
    await context.close();
    await new Promise(resolve => server.close(resolve));
  }
};

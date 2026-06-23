'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const MIME = {
  '.html': 'text/html;charset=utf-8', '.js': 'application/javascript;charset=utf-8',
  '.css': 'text/css;charset=utf-8', '.json': 'application/json;charset=utf-8',
  '.svg': 'image/svg+xml',
};
const WORK = __dirname;
const CHROME = '/usr/bin/chromium';
const PORT = 9910;

const testDir = '/tmp/qa-screenshots-extra';
fs.rmSync(testDir, { recursive: true, force: true });
fs.cpSync(WORK + '/index.html', testDir + '/index.html');
fs.cpSync(WORK + '/assets', testDir + '/assets', { recursive: true });
fs.mkdirSync(testDir + '/data', { recursive: true });

const base = JSON.parse(fs.readFileSync(WORK + '/data/events.json', 'utf8'));
const freshData = JSON.stringify(Object.assign({}, base, { generated_at: new Date(Date.now() - 1*3600000).toISOString() }), null, 2);
fs.writeFileSync(testDir + '/data/events.json', freshData);
fs.cpSync(WORK + '/data/telegram.json', testDir + '/data/telegram.json');

function serve(wd) {
  return http.createServer((req, res) => {
    const urlPath = req.url.split('?')[0];
    const p = path.join(wd, urlPath === '/' ? 'index.html' : urlPath);
    if (!p.startsWith(wd)) { res.writeHead(403); res.end(); return; }
    fs.readFile(p, (err, data) => {
      if (err) { res.writeHead(404); res.end('404'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
      res.end(data);
    });
  });
}

const srv = serve(testDir);
const outDir = '/tmp/qa-screenshots';
fs.mkdirSync(outDir, { recursive: true });

srv.listen(PORT, async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 2400 });

  const logs = [];
  page.on('console', m => logs.push(`${m.type()}: ${m.text()}`));
  page.on('pageerror', err => logs.push(`PAGE_ERROR: ${err.message}`));

  await page.goto(`http://localhost:${PORT}`, { waitUntil: 'networkidle0', timeout: 15000 });
  await page.waitForSelector('#freshness', { timeout: 5000 });
  await new Promise(r => setTimeout(r, 1500));

  // 1. Full page - shows empty weekends in the agenda
  await page.screenshot({ path: outDir + '/gst9-fullpage-agenda.png', fullPage: true });
  console.log('Screenshot: gst9-fullpage-agenda.png');

  // 2. Scroll to the empty weekends region
  await page.evaluate(() => {
    const emptyWk = document.querySelector('.empty-wk');
    if (emptyWk) emptyWk.scrollIntoView({ behavior: 'instant', block: 'center' });
  });
  await new Promise(r => setTimeout(r, 500));
  await page.screenshot({ path: outDir + '/gst9-empty-weekend-detail.png', fullPage: false });
  console.log('Screenshot: gst9-empty-weekend-detail.png');

  // 3. Switch to past mode
  await page.evaluate(() => {
    const pastBtn = document.querySelector('#seg button[data-mode="past"]');
    if (pastBtn) pastBtn.click();
  });
  await new Promise(r => setTimeout(r, 500));
  await page.screenshot({ path: outDir + '/gst9-past-mode.png', fullPage: false });
  console.log('Screenshot: gst9-past-mode.png');

  // 4. Switch back to upcoming, apply a filter that narrows results
  await page.evaluate(() => {
    const upBtn = document.querySelector('#seg button[data-mode="upcoming"]');
    if (upBtn) upBtn.click();
  });
  await new Promise(r => setTimeout(r, 500));
  await page.evaluate(() => {
    // Click a filter chip to narrow results
    const chips = document.querySelectorAll('.chip');
    for (const c of chips) {
      if (c.textContent.trim() === 'Велозаезд') { c.click(); break; }
    }
  });
  await new Promise(r => setTimeout(r, 500));
  await page.screenshot({ path: outDir + '/gst9-filter-narrow.png', fullPage: false });
  console.log('Screenshot: gst9-filter-narrow.png');

  // 5. New filter that yields empty
  await page.evaluate(() => {
    const chips = document.querySelectorAll('.chip');
    chips.forEach(c => { if (c.classList.contains('on')) c.click(); });
  });
  await new Promise(r => setTimeout(r, 300));
  await page.evaluate(() => {
    const chips = document.querySelectorAll('.chip');
    if (chips.length > 0) chips[chips.length - 1].click();
  });
  await new Promise(r => setTimeout(r, 500));
  await page.screenshot({ path: outDir + '/gst9-filter-empty.png', fullPage: false });
  console.log('Screenshot: gst9-filter-empty.png');

  console.log('\nConsole logs:', logs.filter(l => l.startsWith('PAGE_ERROR') || l.startsWith('error:')).join('\n') || 'none');
  await browser.close();
  srv.close();
  console.log('\nDone — screenshots saved to', outDir);
});

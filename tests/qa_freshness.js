#!/usr/bin/env node
'use strict';

/**
 * QA: freshness indicator visual tests.
 * Launches a headless browser, serves the page with controlled data,
 * and validates the freshness UI (dot color, text, banner).
 *
 * Usage: node tests/qa_freshness.js
 * Requires: puppeteer + chromium installed (CI: uses actions/setup-chrome or puppeteer download)
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const MIME = {
  '.html': 'text/html;charset=utf-8', '.js': 'application/javascript;charset=utf-8',
  '.css': 'text/css;charset=utf-8', '.json': 'application/json;charset=utf-8',
  '.svg': 'image/svg+xml',
};

const WORK = __dirname + '/..';
const TEST_BASE = '/tmp/qa-freshness';
let CURRENT_PORT = 8899;

function serve(workdir) {
  return http.createServer((req, res) => {
    const urlPath = req.url.split('?')[0];
    const p = path.join(workdir, urlPath === '/' ? 'index.html' : urlPath);
    if (!p.startsWith(workdir)) { res.writeHead(403); res.end(); return; }
    const ext = path.extname(p);
    fs.readFile(p, (err, data) => {
      if (err) { res.writeHead(404); res.end('404'); return; }
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      res.end(data);
    });
  });
}

function makeData(generatedAt) {
  const base = JSON.parse(fs.readFileSync(WORK + '/data/events.json', 'utf8'));
  return JSON.stringify(Object.assign({}, base, { generated_at: generatedAt }), null, 2);
}

async function findChrome() {
  const candidates = [
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/snap/bin/chromium',
  ];
  for (const c of candidates) {
    try {
      await fs.promises.access(c);
      return c;
    } catch (_) { }
  }
  return null;
}

async function testScenario(chromePath, puppeteer, scenario) {
  const testDir = TEST_BASE + '-' + scenario.name.replace(/[^a-z0-9]/gi, '');
  fs.rmSync(testDir, { recursive: true, force: true });
  fs.cpSync(WORK + '/index.html', testDir + '/index.html');
  fs.cpSync(WORK + '/assets', testDir + '/assets', { recursive: true });
  fs.mkdirSync(testDir + '/data', { recursive: true });
  fs.writeFileSync(testDir + '/data/events.json', makeData(scenario.generatedAt));

  const tgPath = WORK + '/data/telegram.json';
  if (fs.existsSync(tgPath)) {
    fs.cpSync(tgPath, testDir + '/data/telegram.json');
  } else {
    fs.writeFileSync(testDir + '/data/telegram.json', JSON.stringify({ posts: [], events: [] }));
  }

  const server = serve(testDir);
  const port = CURRENT_PORT++;

  return new Promise((resolve, reject) => {
    server.listen(port, async () => {
      try {
        const browser = await puppeteer.launch({
          executablePath: chromePath,
          headless: true,
          args: ['--no-sandbox', '--disable-setuid-sandbox'],
        });
        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 900 });

        const consoleLogs = [];
        page.on('console', msg => consoleLogs.push(`${msg.type()}: ${msg.text()}`));
        page.on('pageerror', err => consoleLogs.push(`PAGE_ERROR: ${err.message}`));
        page.on('response', r => { if (r.status() >= 400) consoleLogs.push(`HTTP ${r.status()}: ${r.url()}`); });

        await page.goto(`http://localhost:${port}`, { waitUntil: 'networkidle0', timeout: 15000 });
        await page.waitForSelector('#freshness', { timeout: 5000 });
        await new Promise(r => setTimeout(r, 500));

        const freshness = await page.evaluate(() => {
          const el = document.getElementById('freshness');
          const text = document.getElementById('f-text');
          const stamp = document.getElementById('stamp');
          const banner = document.getElementById('staleBanner');
          const dot = el ? el.querySelector('.f-dot') : null;
          return {
            freshnessClass: el ? el.className : 'NOT_FOUND',
            dotBgColor: dot ? getComputedStyle(dot).backgroundColor : null,
            fTextContent: text ? text.textContent : null,
            fTextColor: text ? getComputedStyle(text).color : null,
            stampText: stamp ? stamp.textContent : null,
            bannerHidden: banner ? banner.hidden : null,
            bannerAge: banner && !banner.hidden ? (document.getElementById('staleAge') || {}).textContent : null,
          };
        });

        await browser.close();
        server.close();
        resolve({ name: scenario.name, freshness, consoleLogs });
      } catch (err) {
        server.close();
        reject(err);
      }
    });
  });
}

async function main() {
  const puppeteerPath = WORK + '/node_modules/puppeteer';
  if (!fs.existsSync(puppeteerPath)) {
    console.log('SKIP: puppeteer not installed');
    process.exit(0);
  }
  const chromePath = await findChrome();
  if (!chromePath) {
    console.log('SKIP: chromium not found');
    process.exit(0);
  }

  const puppeteer = require(puppeteerPath);
  const now = Date.now();
  const scenarios = [
    { name: 'fresh',  generatedAt: new Date(now - 1 * 3600000).toISOString() },
    { name: 'aging',  generatedAt: new Date(now - 36 * 3600000).toISOString() },
    { name: 'stale',  generatedAt: new Date(now - 72 * 3600000).toISOString() },
    { name: 'unknown', generatedAt: 'invalid-date-string' },
  ];

  let pass = 0, fail = 0;
  for (const s of scenarios) {
    try {
      const r = await testScenario(chromePath, puppeteer, s);
      const ok = (function check() {
        if (r.freshness.freshnessClass === 'NOT_FOUND') return false;
        if (s.name === 'fresh') return r.freshness.freshnessClass === 'freshness fresh';
        if (s.name === 'aging') return r.freshness.freshnessClass === 'freshness aging';
        if (s.name === 'stale') return r.freshness.freshnessClass === 'freshness stale' && r.freshness.bannerHidden === false;
        if (s.name === 'unknown') return r.freshness.freshnessClass === 'freshness stale';
        return false;
      })();
      console.log(`${ok ? 'PASS' : 'FAIL'} ${s.name}: class=${r.freshness.freshnessClass} hidden=${r.freshness.bannerHidden}`);
      if (ok) pass++; else fail++;
    } catch (err) {
      console.log(`FAIL ${s.name}: ${err.message}`);
      fail++;
    }
  }

  const report = {
    timestamp: new Date().toISOString(),
    commit: require('child_process').execSync('git log -1 --format="%h %s"').toString().trim(),
    results: { pass, fail, total: scenarios.length },
  };
  fs.writeFileSync('/tmp/qa-report.json', JSON.stringify(report, null, 2));
  console.log(`\nResults: ${pass}/${scenarios.length} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });

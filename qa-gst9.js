'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const MIME = {
  '.html': 'text/html;charset=utf-8', '.js': 'application/javascript;charset=utf-8',
  '.css': 'text/css;charset=utf-8', '.json': 'application/json;charset=utf-8',
  '.svg': 'image/svg+xml',
};

const WORK = __dirname;
const CHROME = '/usr/bin/chromium';
let CURRENT_PORT = 9900;

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

function makeEmptyData(generatedAt) {
  return JSON.stringify({
    generated_at: generatedAt,
    kudago_ok: true,
    counts: { total: 0, curated: 0, kudago: 0, timepad: 0, season_long: 0, past: 0 },
    events: [],
  }, null, 2);
}

async function setupTestDir(name, dataOverrides) {
  const testDir = '/tmp/qa-gst9-' + name.replace(/[^a-z0-9]/gi, '');
  fs.rmSync(testDir, { recursive: true, force: true });
  fs.cpSync(WORK + '/index.html', testDir + '/index.html');
  fs.cpSync(WORK + '/assets', testDir + '/assets', { recursive: true });
  fs.mkdirSync(testDir + '/data', { recursive: true });
  fs.writeFileSync(testDir + '/data/events.json', dataOverrides.eventsJson || makeData(dataOverrides.generatedAt));
  const tgPath = WORK + '/data/telegram.json';
  if (fs.existsSync(tgPath)) {
    fs.cpSync(tgPath, testDir + '/data/telegram.json');
  } else {
    fs.writeFileSync(testDir + '/data/telegram.json', JSON.stringify({ posts: [], events: [] }));
  }
  return testDir;
}

async function runTest(description, testFn) {
  console.log(`\n─── ${description} ───`);
  try {
    await testFn();
    console.log(`  PASS`);
    return { description, passed: true, error: null };
  } catch (err) {
    console.log(`  FAIL: ${err.message}`);
    return { description, passed: false, error: err.message };
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'Assertion failed');
}

async function launchTest(name, dataOverrides, testPageFn) {
  const testDir = await setupTestDir(name, dataOverrides);
  const server = serve(testDir);
  const port = CURRENT_PORT++;

  return new Promise((resolve, reject) => {
    server.listen(port, async () => {
      const puppeteer = require('puppeteer');
      let browser;
      try {
        browser = await puppeteer.launch({
          executablePath: CHROME,
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
        await new Promise(r => setTimeout(r, 1000));

        const result = await testPageFn(page, browser);

        const screenshotDir = '/tmp/qa-screenshots';
        fs.mkdirSync(screenshotDir, { recursive: true });
        const screenshotPath = `${screenshotDir}/gst9-${name}.png`;
        await page.screenshot({ path: screenshotPath, fullPage: true });

        await browser.close();
        server.close();
        resolve({ name, consoleLogs, screenshotPath, ...result });
      } catch (err) {
        if (browser) await browser.close();
        server.close();
        reject(err);
      }
    });
  });
}

async function main() {
  const results = [];
  const passed = [];
  const failed = [];

  function record(r) {
    results.push(r);
    if (r.passed) passed.push(r); else failed.push(r);
  }

  /* =================================================================
   * TEST SUITE: GST-9a — Continuous weekend rendering + empty state
   * ================================================================= */

  // AC1: All weekends from current through +8 weeks (or last+1) appear as weekend sections
  record(await runTest('AC1: All weekends from current through horizon appear as weekend sections', async () => {
    const r = await launchTest('ac1-continuous', { generatedAt: new Date().toISOString() }, async (page) => {
      const weekendSections = await page.evaluate(() => {
        const sections = document.querySelectorAll('#agenda section.weekend');
        return {
          count: sections.length,
          headers: Array.from(sections).map(s => {
            const rel = s.querySelector('.wk-rel');
            const date = s.querySelector('.wk-date');
            return { rel: rel ? rel.textContent.trim() : '', date: date ? date.textContent.trim() : '' };
          }),
          hasEmpty: Array.from(sections).some(s => !!s.querySelector('.empty-wk')),
        };
      });

      console.log(`  Weekend sections: ${weekendSections.count}`);
      assert(weekendSections.count >= 2, `Expected >=2 weekend sections, got ${weekendSections.count}`);
      assert(weekendSections.hasEmpty, 'Expected at least one empty-weekend placeholder');
      return { weekendSections };
    });
    return r;
  }));

  // AC2: Weekends with events render cards (no regression)
  record(await runTest('AC2: Weekends with events render event cards', async () => {
    const r = await launchTest('ac2-events-cards', { generatedAt: new Date().toISOString() }, async (page) => {
      const eventsInfo = await page.evaluate(() => {
        const sections = document.querySelectorAll('#agenda section.weekend');
        let totalCards = 0;
        let cardsPerSection = [];
        sections.forEach(s => {
          const cards = s.querySelectorAll('.cards .ev');
          cardsPerSection.push(cards.length);
          totalCards += cards.length;
        });
        return { totalCards, cardsPerSection };
      });

      console.log(`  Total event cards: ${eventsInfo.totalCards}`);
      console.log(`  Cards per section: ${JSON.stringify(eventsInfo.cardsPerSection)}`);
      assert(eventsInfo.totalCards > 0, 'Expected at least one event card rendered');
      assert(eventsInfo.cardsPerSection.some(c => c > 0), 'Expected at least one weekend section to have cards');
      return { eventsInfo };
    });
    return r;
  }));

  // AC3: Weekends without events render placeholder with correct message
  record(await runTest('AC3: Empty weekends show friendly placeholder', async () => {
    const r = await launchTest('ac3-empty-placeholder', { generatedAt: new Date().toISOString() }, async (page) => {
      const emptyInfo = await page.evaluate(() => {
        const sections = document.querySelectorAll('#agenda section.weekend');
        const emptySections = Array.from(sections).filter(s => !!s.querySelector('.empty-wk'));
        return {
          totalEmpty: emptySections.length,
          messages: emptySections.map(s => {
            const t = s.querySelector('.empty-wk-t');
            const sub = s.querySelector('.empty-wk-s');
            return { title: t ? t.textContent.trim() : '', subtitle: sub ? sub.textContent.trim() : '' };
          }),
        };
      });

      console.log(`  Empty weekend sections: ${emptyInfo.totalEmpty}`);
      assert(emptyInfo.totalEmpty > 0, 'Expected empty weekend sections');
      emptyInfo.messages.forEach((m, i) => {
        assert(m.title.includes('ничего не нашлось'), `Empty section ${i}: expected 'ничего не нашлось', got '${m.title}'`);
        assert(m.subtitle.includes('посмотри где ещё искать'), `Empty section ${i}: expected suggestion link, got '${m.subtitle}'`);
      });
      return { emptyInfo };
    });
    return r;
  }));

  // AC4: Pre-first-event gaps are filled (current weekend before first event weekend)
  record(await runTest('AC4: Pre-first-event gaps are filled', async () => {
    const r = await launchTest('ac4-pregap', { generatedAt: new Date().toISOString() }, async (page) => {
      const gapInfo = await page.evaluate(() => {
        const sections = document.querySelectorAll('#agenda section.weekend');
        const headers = Array.from(sections).map(s => {
          const rel = s.querySelector('.wk-rel');
          const date = s.querySelector('.wk-date');
          const isEmpty = !!s.querySelector('.empty-wk');
          return { rel: rel ? rel.textContent.trim() : '', date: date ? date.textContent.trim() : '', isEmpty };
        });
        return { sections: headers.map(h => `${h.rel} ${h.date} empty=${h.isEmpty}`), count: headers.length };
      });

      console.log(`  Weekend sections (first 5):`);
      gapInfo.sections.slice(0, 5).forEach(s => console.log(`    ${s}`));
      assert(gapInfo.sections.length >= 2, 'Expected at least 2 weekend sections');

      const first = gapInfo.sections[0];
      assert(first.includes('Ближайшие') || first.includes('Следующие'), `First section should be upcoming: ${first}`);

      return { gapInfo };
    });
    return r;
  }));

  // AC5: Post-last-event gaps are filled (last event weekend → horizon)
  record(await runTest('AC5: Post-last-event gaps filled to horizon', async () => {
    const r = await launchTest('ac5-postgap', { generatedAt: new Date().toISOString() }, async (page) => {
      const lastSections = await page.evaluate(() => {
        const sections = document.querySelectorAll('#agenda section.weekend');
        const lastThree = Array.from(sections).slice(-3);
        return lastThree.map(s => {
          const date = s.querySelector('.wk-date');
          const isEmpty = !!s.querySelector('.empty-wk');
          return { date: date ? date.textContent.trim() : '', isEmpty };
        });
      });

      console.log(`  Last 3 sections:`);
      lastSections.forEach(s => console.log(`    ${s.date} empty=${s.isEmpty}`));
      assert(lastSections.length > 0, 'Expected last sections');
      assert(lastSections.some(s => s.isEmpty), 'Expected some empty sections at the end');
      return { lastSections };
    });
    return r;
  }));

  // AC6: If zero events exist at all, show generic message — never 8 empty weekends
  record(await runTest('AC6: Zero events globally shows generic message, not empty weekends', async () => {
    const r = await launchTest('ac6-zero-events', {
      eventsJson: makeEmptyData(new Date().toISOString()),
    }, async (page) => {
      const agendaState = await page.evaluate(() => {
        const agenda = document.getElementById('agenda');
        const weekendCount = agenda.querySelectorAll('section.weekend').length;
        const pCount = agenda.querySelectorAll('p.block-sub').length;
        const text = agenda.textContent.trim();
        return { weekendCount, pCount, text: text.substring(0, 200) };
      });

      console.log(`  Weekend sections: ${agendaState.weekendCount}`);
      console.log(`  Message: ${agendaState.text.substring(0, 100)}`);
      assert(agendaState.weekendCount === 0, 'Expected ZERO weekend sections (should show generic message)');
      assert(agendaState.pCount > 0, 'Expected a fallback paragraph message');
      assert(agendaState.text.includes('Пока ничего не нашлось'), 'Expected generic empty message');
      return { agendaState };
    });
    return r;
  }));

  // AC7: Past mode unchanged (no gap filling)
  record(await runTest('AC7: Past mode unchanged — no gap filling', async () => {
    const r = await launchTest('ac7-past-mode', { generatedAt: new Date().toISOString() }, async (page) => {
      // Click "Прошлые" tab
      await page.evaluate(() => {
        const pastBtn = document.querySelector('#seg button[data-mode="past"]');
        if (pastBtn) pastBtn.click();
      });
      await new Promise(r => setTimeout(r, 500));

      const pastState = await page.evaluate(() => {
        const agenda = document.getElementById('agenda');
        const sections = agenda.querySelectorAll('section.weekend');
        const emptyWk = agenda.querySelectorAll('.empty-wk');
        const blockSub = agenda.querySelectorAll('p.block-sub');
        const hasPastMsg = Array.from(blockSub).some(p =>
          p.textContent.includes('Прошлых событий')
        );
        return {
          sectionCount: sections.length,
          emptyWeekendCount: emptyWk.length,
          hasPastMessage: hasPastMsg,
          text: agenda.textContent.substring(0, 200),
        };
      });

      console.log(`  Past mode sections: ${pastState.sectionCount}`);
      console.log(`  Past mode empty-weekends: ${pastState.emptyWeekendCount}`);
      console.log(`  Text preview: ${pastState.text.substring(0, 100)}`);
      // Past mode should NOT have empty-weekend placeholders
      assert(pastState.emptyWeekendCount === 0, 'Past mode should have NO empty-weekend placeholders');
      return { pastState };
    });
    return r;
  }));

  /* =================================================================
   * TEST SUITE: GST-9b — Smarter filter-empty message
   * ================================================================= */

  // AC1: Filters active + zero results → specific message
  record(await runTest('GST-9b AC1: Active filters with zero results show correct message', async () => {
    const r = await launchTest('gst9b-ac1-filters-empty', { generatedAt: new Date().toISOString() }, async (page) => {
      const filterResult = await page.evaluate(() => {
        // Get all filter chips
        const chips = document.querySelectorAll('.chip');
        if (!chips.length) return { error: 'No filter chips found', chipCount: 0 };
        // Click last chip to filter to something narrow
        const lastChip = chips[chips.length - 1];
        lastChip.click();
        return { chipCount: chips.length, clickedLabel: lastChip.textContent };
      });
      await new Promise(r => setTimeout(r, 500));

      const agendaAfter = await page.evaluate(() => {
        const agenda = document.getElementById('agenda');
        const pEl = agenda.querySelector('p.block-sub');
        return {
          text: pEl ? pEl.textContent.trim() : 'NO PARAGRAPH',
          sections: agenda.querySelectorAll('section.weekend').length,
          textPreview: agenda.textContent.substring(0, 300),
        };
      });

      console.log(`  Filter clicked: ${filterResult.clickedLabel || '?'}`);
      console.log(`  Agenda text: ${agendaAfter.textPreview.substring(0, 150)}`);

      if (agendaAfter.sections === 0) {
        assert(agendaAfter.text.includes('Ничего не нашлось по этим категориям'),
          `Expected filter-specific message, got: ${agendaAfter.text}`);
      }

      return { filterResult, agendaAfter };
    });
    return r;
  }));

  // AC2: No filters + no data → generic "Пока ничего" message
  record(await runTest('GST-9b AC2: No filters + no data shows generic message', async () => {
    const r = await launchTest('gst9b-ac2-no-data', {
      eventsJson: makeEmptyData(new Date().toISOString()),
    }, async (page) => {
      const state = await page.evaluate(() => {
        const agenda = document.getElementById('agenda');
        const pEl = agenda.querySelector('p.block-sub');
        return {
          text: pEl ? pEl.textContent.trim() : 'NO PARAGRAPH',
          sections: agenda.querySelectorAll('section.weekend').length,
        };
      });

      console.log(`  Message: ${state.text}`);
      assert(state.text.includes('Пока ничего не нашлось'),
        `Expected generic empty message, got: ${state.text}`);
      return { state };
    });
    return r;
  }));

  // AC3: Past mode keeps its existing message
  record(await runTest('GST-9b AC3: Past mode keeps existing message when empty', async () => {
    const r = await launchTest('gst9b-ac3-past-empty', {
      eventsJson: makeEmptyData(new Date().toISOString()),
    }, async (page) => {
      // Switch to past mode
      await page.evaluate(() => {
        const pastBtn = document.querySelector('#seg button[data-mode="past"]');
        if (pastBtn) pastBtn.click();
      });
      await new Promise(r => setTimeout(r, 500));

      const state = await page.evaluate(() => {
        const agenda = document.getElementById('agenda');
        const pEl = agenda.querySelector('p.block-sub');
        return {
          text: pEl ? pEl.textContent.trim() : null,
          sections: agenda.querySelectorAll('section.weekend').length,
        };
      });

      console.log(`  Past message: ${state.text}`);
      assert(state.text && (state.text.includes('Прошлых событий') || state.text.includes('пока нет')),
        `Expected past-empty message, got: ${state.text}`);
      return { state };
    });
    return r;
  }));

  /* =================================================================
   * REGRESSION: Existing features still work
   * ================================================================= */

  // Freshness indicator works
  record(await runTest('REGRESSION: Freshness indicator renders correctly', async () => {
    const r = await launchTest('regression-freshness', { generatedAt: new Date().toISOString() }, async (page) => {
      const freshness = await page.evaluate(() => {
        const el = document.getElementById('freshness');
        const text = document.getElementById('f-text');
        const stamp = document.getElementById('stamp');
        const dot = el ? el.querySelector('.f-dot') : null;
        const banner = document.getElementById('staleBanner');
        return {
          freshnessClass: el ? el.className : 'NOT_FOUND',
          dotBgColor: dot ? getComputedStyle(dot).backgroundColor : null,
          fText: text ? text.textContent : null,
          stampText: stamp ? stamp.textContent : null,
          bannerHidden: banner ? banner.hidden : null,
        };
      });

      console.log(`  Freshness class: ${freshness.freshnessClass}`);
      assert(freshness.freshnessClass !== 'NOT_FOUND', 'Freshness element not found');
      assert(freshness.freshnessClass.includes('freshness'), 'Freshness class missing');
      return { freshness };
    });
    return r;
  }));

  // Tab switching works
  record(await runTest('REGRESSION: Tab switching works (calendar/map/feed)', async () => {
    const r = await launchTest('regression-tabs', { generatedAt: new Date().toISOString() }, async (page) => {
      const tabs = await page.evaluate(() => {
        const vtabButtons = document.querySelectorAll('.vtab');
        const views = {};
        vtabButtons.forEach(btn => {
          btn.click();
          const viewId = 'view-' + btn.dataset.view;
          const viewEl = document.getElementById(viewId);
          views[btn.dataset.view] = viewEl ? !viewEl.hidden : 'NOT_FOUND';
        });
        // Switch back to calendar
        document.querySelector('.vtab[data-view="calendar"]').click();
        return views;
      });

      console.log(`  Tabs: ${JSON.stringify(tabs)}`);
      assert(tabs.calendar === true, 'Calendar view should be visible after click');
      assert(tabs.map === true, 'Map view should be visible after click');
      return { tabs };
    });
    return r;
  }));

  // Sheet/detail overlay opens on event click
  record(await runTest('REGRESSION: Event card click opens detail sheet', async () => {
    const r = await launchTest('regression-sheet', { generatedAt: new Date().toISOString() }, async (page) => {
      const sheetResult = await page.evaluate(() => {
        const firstCard = document.querySelector('.ev');
        if (!firstCard) return { opened: false, reason: 'No event card found' };
        firstCard.click();
        const overlay = document.getElementById('overlay');
        const sheet = document.getElementById('sheet');
        return {
          opened: overlay ? overlay.classList.contains('show') : false,
          sheetExists: !!sheet,
          title: sheet ? (document.getElementById('s-title') || {}).textContent : null,
        };
      });

      console.log(`  Sheet opened: ${sheetResult.opened}`);
      if (sheetResult.title) console.log(`  Event title: ${sheetResult.title.substring(0, 50)}`);
      assert(sheetResult.opened, 'Event sheet should open on card click');
      return { sheetResult };
    });
    return r;
  }));

  /* =================================================================
   * SUMMARY
   * ================================================================= */
  console.log(`\n══════════════════════════════════════════`);
  console.log(`  GST-9 QA TEST SUMMARY`);
  console.log(`══════════════════════════════════════════`);
  console.log(`  Total:  ${results.length}`);
  console.log(`  Passed: ${passed.length}`);
  console.log(`  Failed: ${failed.length}`);
  if (failed.length) {
    console.log(`\n  FAILED TESTS:`);
    failed.forEach(f => console.log(`    ❌ ${f.description}: ${f.error}`));
  }

  const commit = require('child_process').execSync('git log -1 --format="%h %s"').toString().trim();
  const report = {
    timestamp: new Date().toISOString(),
    commit,
    branch: require('child_process').execSync('git rev-parse --abbrev-ref HEAD').toString().trim(),
    suite: 'GST-9 Empty Weekends QA',
    results: results.map(r => ({
      description: r.description,
      passed: r.passed,
      error: r.error || null,
    })),
    summary: { total: results.length, passed: passed.length, failed: failed.length },
  };
  fs.writeFileSync('/tmp/qa-report-gst9.json', JSON.stringify(report, null, 2));
  console.log(`\nReport: /tmp/qa-report-gst9.json`);

  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });

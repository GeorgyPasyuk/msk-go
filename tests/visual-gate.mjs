// visual-gate.mjs — runtime + VISUAL QA gate for msk-go.
// Usage: node visual-gate.mjs <URL>
// Exit: 0 pass | 1 quality FAIL | 2 infra error.
// Checks: console/page errors, content rendered, CSS structural lint,
//         and FLOATING-CONTROL OVERLAP (the class of bug that shipped in MSK-2:
//         scroll-hint chevron overlapping the back-to-top button).
import { chromium } from "playwright";
const URL = process.argv[2];

function cssStructErrors(css) {
  const errs = [];
  let c = css.replace(/\/\*[\s\S]*?\*\//g, "");
  c = c.replace(/"(\\.|[^"\\])*"/g, '""').replace(/'(\\.|[^'\\])*'/g, "''");
  c = c.replace(/@(import|charset|namespace|layer|use)\b[^;{}]*;/gi, "");
  let depth = 0, seg = "";
  for (const ch of c) {
    if (ch === "{") { if (seg.trim().includes(";")) errs.push("orphaned decl in selector: " + seg.trim().slice(0,70)); seg=""; depth++; }
    else if (ch === "}") { depth--; seg=""; if (depth<0){ errs.push("stray '}'"); depth=0; } }
    else seg += ch;
  }
  if (depth !== 0) errs.push("unclosed '{' depth=" + depth);
  return [...new Set(errs)];
}

// Returns overlapping pairs of VISIBLE, interactive, floating controls at the
// current scroll position. Excludes ancestor/descendant pairs (svg-in-button etc).
const overlapProbe = `() => {
  const isFloat = el => { const cs = getComputedStyle(el); return ['fixed','absolute','sticky'].includes(cs.position); };
  const interactive = el => el.tagName==='BUTTON' || el.tagName==='A' || el.hasAttribute('role') || /btn|button|hint|fab|top/i.test(el.id+' '+el.className);
  const vis = el => { const cs=getComputedStyle(el); const r=el.getBoundingClientRect();
    return cs.display!=='none' && cs.visibility!=='hidden' && parseFloat(cs.opacity)>0.05 && r.width>4 && r.height>4
      && r.bottom>0 && r.top<innerHeight && r.right>0 && r.left<innerWidth; };
  const cands = [...document.querySelectorAll('button,a,[role]')].filter(e=>isFloat(e)&&interactive(e)&&vis(e));
  const rect = e => e.getBoundingClientRect();
  const pairs = [];
  for (let i=0;i<cands.length;i++) for (let j=i+1;j<cands.length;j++){
    const A=cands[i], B=cands[j];
    if (A.contains(B)||B.contains(A)) continue;            // skip nested
    const a=rect(A), b=rect(B);
    const ix=Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left));
    const iy=Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top));
    const inter=ix*iy; if(inter<=0) continue;
    const minA=Math.min(a.width*a.height,b.width*b.height);
    const frac=inter/minA;
    if (frac>0.2) pairs.push({a:(A.id||A.className||A.tagName), b:(B.id||B.className||B.tagName), frac:+frac.toFixed(2)});
  }
  return pairs;
}`;

let browser;
try { browser = await chromium.launch(); }
catch (e) { console.error("GATE-INFRA-ERROR: " + e.message); process.exit(2); }
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } }); // mobile-first (where FABs collide)
  const errors = [];
  page.on("pageerror", e => errors.push("pageerror: " + e.message));
  page.on("console", m => { if (m.type() === "error") errors.push("console.error: " + m.text()); });
  const resp = await page.goto(URL, { waitUntil: "networkidle", timeout: 30000 });
  if (!resp || !resp.ok()) { console.error("HTTP not OK"); await browser.close(); process.exit(1); }
  try { await page.waitForSelector("#agenda section.weekend", { timeout: 8000 }); } catch {}
  const weekends = await page.$$eval("#agenda section.weekend", els => els.length).catch(() => 0);

  // overlap at several scroll positions (FABs appear/hide on scroll)
  const positions = [0, 400, 99999];
  const overlapHits = [];
  for (const y of positions) {
    await page.evaluate(yy => window.scrollTo(0, yy), y);
    await page.waitForTimeout(400);
    const pairs = await page.evaluate(eval('(' + overlapProbe + ')'));
    if (pairs.length) overlapHits.push({ scrollY: y, pairs });
  }

  const cssTexts = await page.evaluate(async () => {
    const out = [];
    for (const l of document.querySelectorAll("link[rel=stylesheet]")) { try { out.push(await (await fetch(l.href)).text()); } catch { out.push(""); } }
    for (const s of document.querySelectorAll("style")) out.push(s.textContent || "");
    return out;
  });
  await browser.close();

  let ok = true;
  if (errors.length) { console.error("RUNTIME ERRORS:\n" + errors.join("\n")); ok = false; }
  if (weekends < 1) { console.error("CONTENT NOT RENDERED: 0 weekend sections"); ok = false; }
  const cssErrs = cssTexts.flatMap(cssStructErrors);
  if (cssErrs.length) { console.error("CSS STRUCTURE ERRORS:\n" + [...new Set(cssErrs)].join("\n")); ok = false; }
  if (overlapHits.length) { console.error("VISUAL OVERLAP (floating controls):\n" + JSON.stringify(overlapHits, null, 2)); ok = false; }
  console.log(`weekends=${weekends} errors=${errors.length} cssErrs=${cssErrs.length} overlapHits=${overlapHits.length}`);
  process.exit(ok ? 0 : 1);
} catch (e) {
  console.error("GATE-INFRA-ERROR: " + e.message);
  try { await browser.close(); } catch {}
  process.exit(2);
}

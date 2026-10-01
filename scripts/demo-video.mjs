/**
 * Records a short demo video of the app (1920×1080 MP4) for presentations.
 *
 *   SEED_PASSWORD=… node scripts/demo-video.mjs      (app running on :4200, seeded demo data)
 *
 * A scripted tour drives the app like a person would, with a visible cursor and
 * captions. Frames are captured with the Chrome DevTools screencast at full
 * resolution, then replayed onto a canvas and encoded to H.264 by Chrome's own
 * MediaRecorder, so no ffmpeg is needed. Output: docs/demo/contract-hub-demo.mp4
 */
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const BASE = process.env.BASE_URL ?? 'http://localhost:4200';
const PASSWORD = process.env.SEED_PASSWORD;
if (!PASSWORD) throw new Error('Set SEED_PASSWORD to the demo accounts’ password');
const OUT_DIR = new URL('../docs/demo/', import.meta.url).pathname;
/** Captured frames are kept here, so `--encode-only` can re-encode without recording again. */
const FRAMES = join(tmpdir(), 'contract-hub-demo-frames');
const ENCODE_ONLY = process.argv.includes('--encode-only');
const W = 1280;
const H = 720;
const SCALE = 1.5; // 1920×1080 frames

/** Cursor, click ripple, captions and title cards, injected into every page. */
const OVERLAY = () => {
  const style = `
    #demo-cursor{position:fixed;left:0;top:0;width:22px;height:22px;z-index:2147483646;pointer-events:none;transition:transform .05s linear;filter:drop-shadow(0 2px 3px rgba(0,0,0,.35))}
    .demo-ripple{position:fixed;width:36px;height:36px;margin:-18px 0 0 -18px;border-radius:50%;border:3px solid #ec9a1c;z-index:2147483646;pointer-events:none;animation:demo-ripple .5s ease-out forwards}
    @keyframes demo-ripple{from{transform:scale(.3);opacity:1}to{transform:scale(1.4);opacity:0}}
    #demo-caption{position:fixed;left:50%;bottom:28px;transform:translateX(-50%) translateY(20px);opacity:0;z-index:2147483645;pointer-events:none;
      max-width:80%;padding:12px 22px;border-radius:16px;background:rgba(10,16,38,.88);color:#fff;font:600 20px/1.35 Inter,system-ui,sans-serif;
      letter-spacing:-.01em;text-align:center;box-shadow:0 12px 40px rgba(0,0,0,.35);transition:opacity .35s ease,transform .35s ease}
    #demo-caption.on{opacity:1;transform:translateX(-50%) translateY(0)}
    #demo-caption b{color:#f4b860;font-weight:700}
    #demo-card{position:fixed;inset:0;z-index:2147483647;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;
      background:radial-gradient(60rem 40rem at 20% -10%,#3d63f066,transparent),radial-gradient(40rem 30rem at 110% 110%,#ec9a1c44,transparent),#0b1230;
      color:#fff;font-family:Inter,system-ui,sans-serif;text-align:center;opacity:0;transition:opacity .5s ease}
    #demo-card.on{opacity:1}
    #demo-card h1{margin:0;font-size:64px;font-weight:700;letter-spacing:-.03em;color:#fff}
    #demo-card p{margin:0;font-size:24px;color:#c7d2fe;max-width:900px;line-height:1.4}
    #demo-card .chips{display:flex;flex-wrap:wrap;justify-content:center;gap:10px;max-width:980px;margin-top:8px}
    #demo-card .chips span{padding:8px 16px;border-radius:999px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.16);font-size:18px;color:#e0e7ff}
    #demo-card small{font-size:18px;color:#94a3b8;margin-top:10px}`;
  const install = () => {
    if (document.getElementById('demo-cursor')) return;
    const s = document.createElement('style');
    s.textContent = style;
    document.head.appendChild(s);
    const cursor = document.createElement('div');
    cursor.id = 'demo-cursor';
    cursor.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M4 2l15 10.5-6.6 1.3 3.8 7.3-2.6 1.3-3.8-7.3L4 20z" fill="#fff" stroke="#0b1230" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    document.body.appendChild(cursor);
    const caption = document.createElement('div');
    caption.id = 'demo-caption';
    document.body.appendChild(caption);
    const pos = JSON.parse(sessionStorage.getItem('demo-pos') ?? '[640,360]');
    cursor.style.transform = `translate(${pos[0]}px,${pos[1]}px)`;
    addEventListener('mousemove', (e) => {
      cursor.style.transform = `translate(${e.clientX}px,${e.clientY}px)`;
      sessionStorage.setItem('demo-pos', JSON.stringify([e.clientX, e.clientY]));
    }, true);
    addEventListener('mousedown', (e) => {
      const r = document.createElement('div');
      r.className = 'demo-ripple';
      r.style.left = `${e.clientX}px`;
      r.style.top = `${e.clientY}px`;
      document.body.appendChild(r);
      setTimeout(() => r.remove(), 600);
    }, true);
    const saved = sessionStorage.getItem('demo-caption');
    if (saved) window.__caption(saved, true);
  };
  window.__caption = (html, instant) => {
    const el = document.getElementById('demo-caption');
    if (!el) return;
    sessionStorage.setItem('demo-caption', html ?? '');
    if (!html) return el.classList.remove('on');
    if (instant) {
      el.innerHTML = html;
      el.classList.add('on');
      return;
    }
    el.classList.remove('on');
    setTimeout(() => {
      el.innerHTML = html;
      el.classList.add('on');
    }, el.innerHTML ? 250 : 0);
  };
  window.__card = (html) => {
    let card = document.getElementById('demo-card');
    if (!html) {
      card?.classList.remove('on');
      setTimeout(() => card?.remove(), 500);
      return;
    }
    if (!card) {
      card = document.createElement('div');
      card.id = 'demo-card';
      document.body.appendChild(card);
    }
    card.innerHTML = html;
    requestAnimationFrame(() => card.classList.add('on'));
  };
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', install);
  else install();
};

if (!ENCODE_ONLY) await capture();
await encode();

async function capture() {
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: SCALE, locale: 'en-US' });
await context.addInitScript(() => {
  localStorage.setItem('cms-lang', 'en');
  if (!sessionStorage.getItem('demo-theme-set')) {
    localStorage.setItem('cms-theme', 'light');
    sessionStorage.setItem('demo-theme-set', '1');
  }
});
await context.addInitScript(OVERLAY);
const page = await context.newPage();

// --- capture --------------------------------------------------------------------
const frames = [];
const cdp = await context.newCDPSession(page);
cdp.on('Page.screencastFrame', async ({ data, metadata, sessionId }) => {
  frames.push({ data: Buffer.from(data, 'base64'), t: metadata.timestamp });
  await cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
});

const wait = (ms) => page.waitForTimeout(ms);
const caption = (html) => page.evaluate((h) => window.__caption(h), html);
const card = (html) => page.evaluate((h) => window.__card(h), html);

/** Moves the visible cursor to an element, then clicks it. */
async function click(locator, { pause = 250 } = {}) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) throw new Error(`Not visible: ${locator}`);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 22 });
  await wait(pause);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

async function smoothScroll(y, ms = 900) {
  await page.evaluate(([to, dur]) => new Promise((done) => {
    const from = scrollY;
    const start = performance.now();
    const step = (now) => {
      const k = Math.min(1, (now - start) / dur);
      scrollTo(0, from + (to - from) * (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2));
      if (k < 1) requestAnimationFrame(step);
      else done();
    };
    requestAnimationFrame(step);
  }), [y, ms]);
}

await page.goto(`${BASE}/login`);
await page.waitForSelector('input[type=email]');
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: W * SCALE, maxHeight: H * SCALE, everyNthFrame: 1 });

// 0. Title card
await card(`<h1>Contract Hub</h1><p>Contract lifecycle management: draft, approve, sign and renew, all in one place.</p>
  <div class="chips"><span>Angular</span><span>Node.js · Express</span><span>PostgreSQL · Prisma</span><span>Docker · CI</span></div>`);
await wait(3800);
await card(null);
await wait(600);

// 1. Sign in
await caption('Secure sign-in, with <b>keep me signed in</b> and password reset');
await click(page.locator('input[type=email]'));
await page.keyboard.type('admin@contracthub.dev', { delay: 35 });
await click(page.locator('input[type=password]'), { pause: 100 });
await page.keyboard.type(PASSWORD, { delay: 45 });
await wait(300);
await click(page.locator('button[type=submit]'));
await page.waitForURL(`${BASE}/`);
await page.waitForSelector('text=Insights');
await wait(800);

// 2. Dashboard
await caption('A dashboard of <b>what needs your attention</b>');
await wait(3000);
await caption('Live charts: value signed, upcoming renewals, <b>approval time per department</b>');
await smoothScroll(330, 1100);
await wait(2000);
await click(page.getByRole('radio', { name: 'USD' }));
await wait(2200);
await smoothScroll(0, 700);

// 3. Contracts
await caption('Every contract: <b>search, filter, sort, export</b>');
await click(page.locator('nav a', { hasText: 'Contracts' }));
await page.waitForSelector('tbody tr');
await wait(1200);
await click(page.getByRole('tab', { name: 'In review' }));
await wait(2200);

// 4. Contract detail + comment on a clause
await click(page.locator('tbody tr', { hasText: 'Northwind distribution agreement' }));
await page.waitForSelector('text=Minimum volumes');
await caption('Each contract: <b>clauses, versions, approvals, signatures</b> and a full timeline');
await wait(3000);
const clauseButton = page.getByRole('button', { name: /Comments on Minimum volumes/ });
await smoothScroll((await clauseButton.evaluate((el) => el.getBoundingClientRect().top + scrollY)) - 160, 900);
await caption('Discuss any clause and <b>@mention</b> colleagues');
await click(clauseButton);
await wait(500);
const box = page.locator('cms-discussion textarea').first();
await click(box, { pause: 150 });
await page.keyboard.type('Can we lower the minimum to 400 units? @lei', { delay: 38 });
await wait(700);
await page.keyboard.press('Enter');
await page.keyboard.type('what do you think?', { delay: 38 });
await wait(500);
await page.keyboard.press('Control+Enter');
await wait(2400);

// 5. Approval workflow
await smoothScroll(0, 700);
await caption('A configurable <b>approval workflow</b>: stages, parallel reviews, conditional steps, escalation');
await click(page.getByRole('tab', { name: 'Approvals' }));
await wait(4000);

// 6. PDF preview
await caption('A real <b>contract PDF</b> for every version, previewed in the app');
await click(page.getByRole('button', { name: 'Preview PDF' }));
await wait(4500);
await page.keyboard.press('Escape');
await wait(600);

// 6b. Approver's queue
await caption('Approvers get a <b>queue</b>, live notifications and <b>escalation</b> when a step is overdue');
await click(page.locator('nav a', { hasText: 'Approvals' }));
await page.waitForSelector('text=Approve');
await wait(2000);
await click(page.locator('cms-notification-bell button').first());
await wait(2600);
await page.keyboard.press('Escape');
await wait(500);

// 7. E-signature
await caption('Built-in <b>e-signature</b>, for colleagues and external parties, with evidence');
await page.goto(`${BASE}/contracts?q=Fabrikam%20sales%20training`);
await page.waitForSelector('tbody tr');
await wait(500);
await click(page.locator('tbody tr').first());
await page.waitForSelector('text=Fabrikam sales training 2026');
await wait(900);
await click(page.getByRole('tab', { name: 'Signatures' }));
await wait(4000);

// 8. Renewals calendar
await caption('A <b>renewals calendar</b> colour-coded by risk, plus reminders and auto-renewal');
await click(page.locator('nav a', { hasText: 'Renewals' }));
await page.waitForSelector('text=Needs a decision');
await wait(2600);
await click(page.getByRole('button', { name: 'Next month' }));
await wait(2400);

// 9. Dark mode and French
await caption('<b>Dark mode</b>, and the whole app in <b>English or French</b>');
await click(page.locator('aside [aria-label="Dark"]'));
await wait(1300);
await click(page.locator('aside [aria-label="Français"]'));
await wait(2800);
await caption(null);
await wait(400);

// 10. Closing card
await card(`<h1>Contract Hub</h1>
  <div class="chips"><span>Approval workflow engine</span><span>E-signature</span><span>Contract PDFs</span><span>Renewals & reminders</span>
  <span>Live updates</span><span>Comments & @mentions</span><span>Audit log</span><span>EN / FR</span><span>Docker & CI</span></div>
  <small>github.com/Eya2/contract_management</small>`);
await wait(5500);

const end = Date.now() / 1000; // the last seconds may be static, so no frame marks them
await cdp.send('Page.stopScreencast');
await browser.close();
console.log(`Captured ${frames.length} frames over ${(frames.at(-1).t - frames[0].t).toFixed(1)} s`);
await rm(FRAMES, { recursive: true, force: true });
await mkdir(FRAMES, { recursive: true });
await Promise.all(frames.map((f, i) => writeFile(join(FRAMES, `${String(i).padStart(5, '0')}.jpg`), f.data)));
await writeFile(join(FRAMES, 'times.json'), JSON.stringify({ times: frames.map((f) => f.t), end }));
}

// --- encode -------------------------------------------------------------------------
// Replays the frames in real time onto a canvas and records it with MediaRecorder.
async function encode() {
const { times: stamps, end } = JSON.parse(await readFile(join(FRAMES, 'times.json'), 'utf8'));
const names = (await readdir(FRAMES)).filter((f) => f.endsWith('.jpg')).sort();
const frames = await Promise.all(names.map(async (n, i) => ({ data: await readFile(join(FRAMES, n)), t: stamps[i] })));
const encoder = await chromium.launch({ channel: 'chrome', headless: true });
const ep = await (await encoder.newContext()).newPage();
await ep.route('http://frames.local/**', (route) => {
  const i = Number(new URL(route.request().url()).pathname.slice(1));
  return route.fulfill({ status: 200, contentType: 'image/jpeg', body: frames[i].data });
});
await ep.goto('http://frames.local/0');
const t0 = frames[0].t;
const times = frames.map((f) => f.t - t0);
const total = Math.max(times.at(-1) + 0.5, end - t0);
const mp4 = await ep.evaluate(async ({ times, total, w, h }) => {
  const canvas = Object.assign(document.createElement('canvas'), { width: w, height: h });
  const ctx = canvas.getContext('2d');
  const load = async (i) => createImageBitmap(await (await fetch(`/${i}`)).blob());
  const ahead = new Map();
  const get = (i) => {
    if (!ahead.has(i)) ahead.set(i, load(i));
    return ahead.get(i);
  };
  ctx.drawImage(await get(0), 0, 0, w, h);
  const stream = canvas.captureStream(30);
  const rec = new MediaRecorder(stream, { mimeType: 'video/mp4;codecs=avc1.640028', videoBitsPerSecond: 12_000_000 });
  const chunks = [];
  rec.ondataavailable = (e) => chunks.push(e.data);
  const done = new Promise((r) => (rec.onstop = r));
  rec.start(1000);
  const start = performance.now();
  let i = 0;
  for (;;) {
    const now = (performance.now() - start) / 1000;
    if (now >= total) break;
    let next = i;
    while (next + 1 < times.length && times[next + 1] <= now) next++;
    for (let k = next + 1; k < Math.min(times.length, next + 6); k++) get(k);
    // Redraw every tick, even when nothing changed: the canvas stream only
    // emits frames on draws, and still scenes (like the closing card) must last.
    const bitmap = await get(next);
    ctx.drawImage(bitmap, 0, 0, w, h);
    if (next !== i) {
      for (const key of ahead.keys()) if (key < next) ahead.delete(key);
      i = next;
    }
    await new Promise((r) => requestAnimationFrame(r));
  }
  rec.stop();
  await done;
  const blob = new Blob(chunks, { type: 'video/mp4' });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let k = 0; k < bytes.length; k += 0x8000) s += String.fromCharCode(...bytes.subarray(k, k + 0x8000));
  return btoa(s);
}, { times, total, w: W * SCALE, h: H * SCALE });
await encoder.close();

await mkdir(OUT_DIR, { recursive: true });
const file = `${OUT_DIR}contract-hub-demo.mp4`;
await writeFile(file, Buffer.from(mp4, 'base64'));
console.log(`Wrote ${file} (${(Buffer.from(mp4, 'base64').length / 1e6).toFixed(1)} MB, ${total.toFixed(1)} s)`);
}

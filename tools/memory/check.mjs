// The measurement: loads one address in a headless Chrome of its own, waits, and writes where the
// memory is, as one JSON file and a short table. Run it against a game's dev server or its live
// address; compare two runs with diff.mjs. `--help` says how, README.md says what the numbers are.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CHECK_USAGE, parseCheckArgs } from './lib/args.mjs';
import { connect, within } from './lib/cdp.mjs';
import { findChrome, launchChrome } from './lib/chrome.mjs';
import { readHeaps, readProcesses, residentNow, summariseSnapshot } from './lib/collect.mjs';
import { groupInventory } from './lib/inventory.mjs';
import { formatGroups, formatRun } from './lib/report.mjs';
import { TRACKER_SOURCE } from './lib/track.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The run's name when none is given: the address's host and the time, `host-20261127T101500`. */
export function defaultLabel(url, now = new Date()) {
  const host = new URL(url).hostname.replace(/[^A-Za-z0-9.-]/g, '-');
  return `${host}-${now.toISOString().replace(/[-:]/g, '').replace(/\..*$/, '')}`;
}

/** What the page says about itself: its title, its body's classes and the data-* attributes of its
 * html and body elements (a game that writes its build or tier there is read without being named),
 * and the value of the caller's own expression. Run in the page. */
const SELF_REPORT = (probe) => `(() => {
  const data = (el) => (el ? { ...el.dataset } : {});
  const out = { title: document.title, bodyClass: document.body ? document.body.className : '', htmlData: data(document.documentElement), bodyData: data(document.body), finalUrl: location.href };
  ${probe === undefined ? '' : `try { out.probe = (${probe}); } catch (e) { out.probe = "error: " + e.message; }`}
  return JSON.stringify(out);
})()`;

async function measure(options, browser) {
  const { send, sessions, problems, chunks, pageSession } = browser;
  const evaluate = async (expression, sessionId = pageSession) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true }, sessionId);
    return r.result?.value;
  };
  const start = Date.now();
  const series = [];
  // Every 1 s for the first 30 s, then every 5 s: the page's JS heap, and the resident size of the tab and the GPU process.
  while (Date.now() - start < options.wait * 1000) {
    await sleep(Date.now() - start < 30000 ? 1000 : 5000);
    const heap = await within(evaluate('performance.memory.usedJSHeapSize').catch(() => -1), 3000, -1);
    const [tab, gpu] = residentNow(browser.profileDir);
    series.push({ t: Math.round((Date.now() - start) / 1000), heapMB: heap < 0 ? null : Math.round(heap / 1048576), tabMB: tab, gpuProcessMB: gpu });
  }
  const inv = {
    schema: 1,
    label: options.label,
    url: options.url,
    at: new Date().toISOString(),
    waitSeconds: options.wait,
    viewport: { width: options.width, height: options.height, dpr: options.dpr },
    browser: browser.product,
    platform: process.platform,
    series,
  };
  inv.page = JSON.parse((await evaluate(SELF_REPORT(options.probe))) ?? '{}');
  inv.processes = readProcesses(browser.profileDir);
  // The page's target was listed before it navigated, so its url is the page's own report of where it ended up.
  inv.heaps = (await readHeaps(send, sessions)).map((h) => (h.type === 'page' ? { ...h, url: (inv.page.finalUrl ?? h.url).slice(-60) } : h));
  inv.performanceMemory = JSON.parse((await evaluate('JSON.stringify({ used: performance.memory.usedJSHeapSize, total: performance.memory.totalJSHeapSize, limit: performance.memory.jsHeapSizeLimit })')) ?? 'null');
  const report = await evaluate('globalThis.__gpuReport ? globalThis.__gpuReport() : null');
  inv.gpu = report ? { available: true, ...JSON.parse(report) } : { available: false, bufferBytes: 0, textureBytes: 0, count: 0, unknownFormats: [], entries: [] };
  if (options.heap) {
    inv.snapshots = [];
    for (const [sessionId, info] of sessions) {
      if (info.type !== 'page' && info.type !== 'worker') continue;
      await send('HeapProfiler.enable', {}, sessionId);
      chunks.set(sessionId, []);
      await send('HeapProfiler.takeHeapSnapshot', { reportProgress: false, captureNumericValue: false }, sessionId);
      const text = (chunks.get(sessionId) ?? []).join('');
      chunks.delete(sessionId);
      const entry = { type: info.type, url: (info.url ?? '').slice(-60) };
      inv.snapshots.push(text.length < 100 ? { ...entry, totalMB: -1, top: ['(no snapshot)'], holders: [] } : { ...entry, ...summariseSnapshot(text, { withHolders: info.type === 'page' }) });
    }
  }
  const shot = await send('Page.captureScreenshot', { format: 'jpeg', quality: 70 }, pageSession);
  inv.problems = problems.slice(0, 5);
  return { inv, screenshot: Buffer.from(shot.data, 'base64') };
}

/** Starts the browser and the page, measures, and always shuts the browser down. `options` are `parseCheckArgs`'s. */
export async function main(options) {
  options.label ??= defaultLabel(options.url);
  const chrome = findChrome({ chrome: options.chrome });
  const launched = await launchChrome({ chrome, width: options.width, height: options.height });
  // Ctrl-C and a kill end the browser and remove its profile before this process goes.
  const stop = (signal) => launched.close().finally(() => process.exit(signal === 'SIGINT' ? 130 : 143));
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  let send;
  try {
    send = await connect(launched.wsUrl);
    const sessions = new Map();
    const chunks = new Map();
    const problems = [];
    send.on('Target.attachedToTarget', (p) => {
      sessions.set(p.sessionId, p.targetInfo);
      send('Runtime.runIfWaitingForDebugger', {}, p.sessionId).catch(() => undefined);
      if (p.targetInfo.type === 'page') send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, p.sessionId).catch(() => undefined);
    });
    send.on('HeapProfiler.addHeapSnapshotChunk', (p, sessionId) => chunks.set(sessionId, [...(chunks.get(sessionId) ?? []), p.chunk]));
    send.on('Runtime.exceptionThrown', (p) => problems.push((p.exceptionDetails.exception?.description ?? p.exceptionDetails.text).slice(0, 200)));
    const { targetInfos } = await send('Target.getTargets');
    const page = targetInfos.find((t) => t.type === 'page');
    const { sessionId: pageSession } = await send('Target.attachToTarget', { targetId: page.targetId, flatten: true });
    sessions.set(pageSession, page);
    await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, pageSession);
    for (const domain of ['Page', 'Runtime']) await send(`${domain}.enable`, {}, pageSession);
    await send('Emulation.setDeviceMetricsOverride', { width: options.width, height: options.height, deviceScaleFactor: options.dpr, mobile: false }, pageSession);
    await send('Page.addScriptToEvaluateOnNewDocument', { source: TRACKER_SOURCE, runImmediately: true }, pageSession);
    const nav = await send('Page.navigate', { url: options.url }, pageSession);
    if (nav.errorText) throw new Error(`the browser could not load ${options.url}: ${nav.errorText}`);
    const version = await send('Browser.getVersion');
    const { inv, screenshot } = await measure(options, { send, sessions, chunks, problems, pageSession, profileDir: launched.profileDir, product: version.product });
    mkdirSync(options.out, { recursive: true });
    writeFileSync(join(options.out, `${options.label}.json`), JSON.stringify(inv, null, 1));
    writeFileSync(join(options.out, `${options.label}.jpg`), screenshot);
    console.log(formatRun(inv, formatGroups(groupInventory(inv), 15)));
    console.log(`written: ${join(options.out, `${options.label}.json`)}`);
  } finally {
    send?.close();
    await launched.close();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  let options;
  try {
    options = parseCheckArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`${error.message}\n\n${CHECK_USAGE}`);
    process.exit(2);
  }
  if (options.help) console.log(CHECK_USAGE);
  else {
    main(options).then(
      () => process.exit(0),
      (error) => {
        console.error(error.message);
        process.exit(1);
      },
    );
  }
}

'use strict';

/**
 * Regression checks for event-scoped cloud reads/writes in index.html.
 *
 * This test deliberately extracts the production functions from index.html
 * instead of copying their implementation.  It runs without a browser or a
 * CloudBase connection:
 *
 *   node score-review-web/tests/event-switch.test.js
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const indexPath = path.resolve(__dirname, '..', 'index.html');
const indexSource = fs.readFileSync(indexPath, 'utf8');

function extractFunction(name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matcher = new RegExp(`(?:^|\\n)\\s*((?:async\\s+)?function\\s+${escaped}\\s*\\()`, 'm');
  const match = matcher.exec(indexSource);
  assert.ok(match, `could not extract ${name} from ${indexPath}`);
  const start = match.index + match[0].lastIndexOf(match[1]);
  const end = indexSource.indexOf('\n', start);
  assert.ok(end >= start, `could not find end of ${name} declaration`);
  return indexSource.slice(start, end);
}

const extracted = [
  extractFunction('canonicalCarNumber'),
  extractFunction('parseClock'),
  extractFunction('duration'),
  extractFunction('normalizeTime'),
  extractFunction('normalizeCloudRow'),
  extractFunction('loadCloudRows'),
  extractFunction('saveCloudStage'),
  extractFunction('refreshCloud'),
  extractFunction('autoRefreshBusy'),
];

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolveValue, rejectValue) => {
    resolve = resolveValue;
    reject = rejectValue;
  });
  return { promise, resolve, reject };
}

function createHarness() {
  const elements = new Map();
  const context = {
    console,
    encodeURIComponent,
    setTimeout,
    clearTimeout,
    currentEvent: 'A',
    requestHandler: null,
    element(selector) {
      if (!elements.has(selector)) {
        const classes = new Set();
        elements.set(selector, {
          textContent: '', disabled: false,
          classList: { add: name => classes.add(name), remove: name => classes.delete(name) },
        });
      }
      return elements.get(selector);
    },
    persistCount: 0,
  };

  const source = `
    const API_BASE = 'https://test.invalid';
    let rows = [];
    let cloudStageRevisions = {};
    let cloudRowsEventId = '';
    let cloudRowsRequestId = 0;
    let cloudConnected = false;
    let cloudError = '';
    let refreshPromise = null;
    let refreshQueued = false;
    let pendingWriteCount = 0;
    let localImportPending = false;

    function $(selector) {
      if (selector === '#eventSelect') return { value: globalThis.currentEvent };
      return globalThis.element(selector);
    }
    function persist() { globalThis.persistCount++; }
    function render() {}
    function isVisibleOverlay() { return false; }
    async function ensureCloudSession() {}
    async function loadManagedEvents() {}
    async function cloudRequest(path, options) {
      return globalThis.requestHandler(path, options);
    }

    ${extracted.join('\n    ')}

    function inspectState() {
      return {
        rows,
        cloudStageRevisions,
        cloudRowsEventId,
        cloudRowsRequestId,
        cloudConnected,
        cloudError,
      };
    }
  `;

  vm.runInNewContext(source, context, { filename: indexPath });
  return context;
}

function eventAndStage(requestPath) {
  const query = requestPath.slice(requestPath.indexOf('?') + 1);
  const params = new URLSearchParams(query);
  return { eventId: params.get('eventId'), stage: params.get('stage') };
}

async function waitFor(predicate, label) {
  const deadline = Date.now() + 2000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise(resolve => setTimeout(resolve, 0));
  }
}

function responseFor(eventId, stage, revision) {
  return {
    ok: true,
    eventId,
    stage,
    rows: [{ carNumber: `${eventId}-${stage}`, startTime: '10:00:00.000', endTime: '10:01:00.000' }],
    count: 1,
    revision,
  };
}

async function resolveEventBatches(pendingGets, eventId, revision) {
  for (let expected = 4; expected <= 20; expected += 4) {
    await waitFor(() => pendingGets.filter(item => item.eventId === eventId).length >= expected, `${eventId} GET batch ${expected / 4}`);
    const eventRequests = pendingGets.filter(item => item.eventId === eventId);
    assert.equal(eventRequests.length, expected, 'only four requests may start before the current batch responds');
    eventRequests.slice(expected - 4).forEach(item => item.request.resolve(responseFor(eventId, item.stage, revision)));
  }
}

async function run() {
  const context = createHarness();
  const pendingGets = [];
  const pendingPuts = [];

  context.requestHandler = (requestPath, options = {}) => {
    if (requestPath.startsWith('/api/work-records?')) {
      const request = deferred();
      pendingGets.push({ ...eventAndStage(requestPath), request });
      return request.promise;
    }
    if (requestPath === '/api/work-records' && options.method === 'PUT') {
      const request = deferred();
      pendingPuts.push({ request, body: JSON.parse(options.body) });
      return request.promise;
    }
    throw new Error(`unexpected cloud request: ${requestPath}`);
  };

  // Start A, switch to B before A responds, and resolve B first.  The old A
  // response must be ignored, and no later A stages may start after switching.
  context.currentEvent = 'A';
  const loadA = vm.runInNewContext('loadCloudRows()', context, { filename: indexPath });
  await waitFor(() => pendingGets.filter(item => item.eventId === 'A').length === 4, 'A first GET batch');

  context.currentEvent = 'B';
  vm.runInNewContext('cloudRowsRequestId++; cloudRowsEventId = ""; cloudStageRevisions = {}; rows = []; cloudConnected = false;', context);
  const loadB = vm.runInNewContext('loadCloudRows()', context, { filename: indexPath });
  await resolveEventBatches(pendingGets, 'B', 21);
  assert.equal(await loadB, true, 'current event B should load successfully');
  pendingGets.filter(item => item.eventId === 'A').forEach(item => item.request.resolve(responseFor('A', item.stage, 11)));
  assert.equal(await loadA, false, 'stale event A load should be ignored');
  assert.equal(pendingGets.filter(item => item.eventId === 'A').length, 4, 'switching events must stop later A requests');

  let state = vm.runInNewContext('inspectState()', context);
  assert.equal(state.cloudRowsEventId, 'B');
  assert.deepEqual(JSON.parse(JSON.stringify(state.cloudStageRevisions)), Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`SS${i + 1}`, 21])));
  assert.equal(state.rows.length, 20);
  assert.ok(state.rows.every(row => row.car.startsWith('B')), 'old A rows must not replace B rows');

  // A save started for B must be rejected after the user switches to C, even
  // before a new C load starts.
  context.currentEvent = 'C';
  await assert.rejects(
    () => vm.runInNewContext('saveCloudStage("SS1")', context, { filename: indexPath }),
    /赛事成绩仍在刷新或加载失败/,
    'saving a different selected event must be rejected',
  );

  // Restore B state for an in-flight PUT, then switch to C while that PUT is
  // unresolved.  A late B response must not overwrite C rows or revisions.
  context.currentEvent = 'B';
  const saveB = vm.runInNewContext('saveCloudStage("SS1")', context, { filename: indexPath });
  await waitFor(() => pendingPuts.length === 1, 'B PUT');
  assert.equal(pendingPuts[0].body.eventId, 'B');
  assert.equal(pendingPuts[0].body.stage, 'SS1');
  assert.equal(pendingPuts[0].body.expectedRevision, 21);

  context.currentEvent = 'C';
  vm.runInNewContext('cloudRowsRequestId++; cloudRowsEventId = ""; cloudStageRevisions = {}; rows = []; cloudConnected = false;', context);
  const loadC = vm.runInNewContext('loadCloudRows()', context, { filename: indexPath });
  await resolveEventBatches(pendingGets, 'C', 31);
  assert.equal(await loadC, true, 'current event C should load successfully');

  pendingPuts[0].request.resolve({ ok: true, count: 1, revision: 22 });
  await saveB;
  state = vm.runInNewContext('inspectState()', context);
  assert.equal(state.cloudRowsEventId, 'C');
  assert.deepEqual(JSON.parse(JSON.stringify(state.cloudStageRevisions)), Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`SS${i + 1}`, 31])));
  assert.equal(state.rows.length, 20);
  assert.ok(state.rows.every(row => row.car.startsWith('C')), 'late B PUT must not replace C rows');

  // A duplicate record is a data error, not an expired login.  Preserve the
  // complete previous cache and identify the failing stage without retrying
  // later batches or telling the operator to log in again.
  const beforeFailure = JSON.stringify(state.rows);
  const persistsBeforeFailure = context.persistCount;
  const failedStages = [];
  context.requestHandler = async requestPath => {
    const { eventId, stage } = eventAndStage(requestPath);
    failedStages.push(stage);
    if (stage === 'SS1') throw new Error('云端成绩记录重复：C/SS1；请先清理重复记录');
    return responseFor(eventId, stage, 99);
  };
  await vm.runInNewContext('refreshCloud()', context, { filename: indexPath });
  state = vm.runInNewContext('inspectState()', context);
  assert.match(state.cloudError, /^SS1：云端成绩记录重复/);
  assert.equal(state.cloudConnected, false);
  assert.equal(JSON.stringify(state.rows), beforeFailure, 'failed refresh must not replace cached rows');
  assert.equal(context.persistCount, persistsBeforeFailure, 'failed refresh must not persist incomplete rows');
  assert.deepEqual(failedStages, ['SS1', 'SS2', 'SS3', 'SS4']);
  assert.match(context.element('#connectionNotice').textContent, /本机缓存尚未同步/);
  assert.doesNotMatch(context.element('#connectionNotice').textContent, /重新登录/);

  // The actual refresh entry point serializes requests.  Switching events
  // while it is busy must queue the new event instead of losing that refresh.
  const queuedContext = createHarness();
  const queuedGets = [];
  queuedContext.requestHandler = requestPath => {
    const request = deferred();
    queuedGets.push({ ...eventAndStage(requestPath), request });
    return request.promise;
  };
  const refreshA = vm.runInNewContext('refreshCloud()', queuedContext, { filename: indexPath });
  await waitFor(() => queuedGets.length === 4, 'queued A first GET batch');
  queuedContext.currentEvent = 'B';
  vm.runInNewContext('cloudRowsRequestId++; cloudRowsEventId = ""; cloudStageRevisions = {}; rows = []; cloudConnected = false;', queuedContext);
  const refreshB = vm.runInNewContext('refreshCloud()', queuedContext, { filename: indexPath });
  assert.equal(queuedGets.length, 4, 'queued refresh must wait for existing requests');
  queuedGets.filter(item => item.eventId === 'A').forEach(item => item.request.resolve(responseFor('A', item.stage, 11)));
  await resolveEventBatches(queuedGets, 'B', 21);
  await Promise.all([refreshA, refreshB]);
  const queuedState = vm.runInNewContext('inspectState()', queuedContext);
  assert.equal(queuedState.cloudRowsEventId, 'B');
  assert.equal(queuedState.cloudConnected, true);
  assert.equal(queuedGets.filter(item => item.eventId === 'A').length, 4);
  assert.ok(queuedState.rows.every(row => row.car.startsWith('B')));

  console.log('event-switch regression tests passed');
}

run().catch(error => {
  console.error(`event-switch regression tests failed: ${error.stack || error}`);
  process.exitCode = 1;
});


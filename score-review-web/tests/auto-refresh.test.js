const test = require('node:test')
const assert = require('node:assert/strict')
const { createAutoRefreshController } = require('../auto-refresh')

function fakeDocument() {
  const listeners = new Map()
  return { visibilityState: 'visible', addEventListener(type, listener) { listeners.set(type, listener) }, removeEventListener(type) { listeners.delete(type) }, dispatch(type) { listeners.get(type)?.() }, listenerCount(type) { return listeners.has(type) ? 1 : 0 } }
}
function fakeWindow() {
  const listeners = new Map()
  return { navigator: { onLine: true }, addEventListener(type, listener) { listeners.set(type, listener) }, removeEventListener(type) { listeners.delete(type) }, dispatch(type) { listeners.get(type)?.() }, listenerCount(type) { return listeners.has(type) ? 1 : 0 } }
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() }

function fakeTimers() {
  let now = 0; let nextId = 1; const timers = new Map()
  const setTimeoutFn = (callback, delay) => { const id = nextId++; timers.set(id, { at: now + delay, callback }); return id }
  const clearTimeoutFn = id => timers.delete(id)
  const tick = async ms => {
    const end = now + ms
    while (true) {
      let next = null
      for (const [id, timer] of timers) if (timer.at <= end && (!next || timer.at < next.timer.at)) next = { id, timer }
      if (!next) break
      timers.delete(next.id); now = next.timer.at; next.timer.callback(); await flush()
    }
    now = end; await Promise.resolve()
  }
  return { setTimeoutFn, clearTimeoutFn, tick, get size() { return timers.size } }
}

 test('slow refreshes never overlap and wait 15 seconds after completion', async () => {
  const timers = fakeTimers(), documentRef = fakeDocument(), windowRef = fakeWindow(); let calls = 0; let resolveFirst
  const refresh = () => { calls += 1; if (calls === 1) return new Promise(resolve => { resolveFirst = resolve }); return true }
  const controller = createAutoRefreshController({ refresh, documentRef, windowRef, intervalMs: 15000, setTimeoutFn: timers.setTimeoutFn, clearTimeoutFn: timers.clearTimeoutFn })
  controller.start(); await flush(); assert.equal(calls, 1); await timers.tick(60000); assert.equal(calls, 1)
  resolveFirst(true); await flush(); assert.equal(timers.size, 1); await timers.tick(14999); assert.equal(calls, 1); await timers.tick(1); assert.equal(calls, 2); controller.stop()
})

test('hidden and offline pages pause timers and recover immediately', async () => {
  const timers = fakeTimers(), documentRef = fakeDocument(), windowRef = fakeWindow(); let calls = 0
  const controller = createAutoRefreshController({ refresh: () => { calls += 1; return true }, documentRef, windowRef, intervalMs: 15000, setTimeoutFn: timers.setTimeoutFn, clearTimeoutFn: timers.clearTimeoutFn })
  controller.start(); await flush(); assert.equal(calls, 1); documentRef.visibilityState = 'hidden'; documentRef.dispatch('visibilitychange'); assert.equal(timers.size, 0); await timers.tick(60000); assert.equal(calls, 1)
  documentRef.visibilityState = 'visible'; documentRef.dispatch('visibilitychange'); await flush(); assert.equal(calls, 2); windowRef.navigator.onLine = false; windowRef.dispatch('offline'); assert.equal(timers.size, 0); windowRef.navigator.onLine = true; windowRef.dispatch('online'); await flush(); assert.equal(calls, 3); controller.stop()
})

test('busy refreshes retry until editing ends', async () => {
  const timers = fakeTimers(), documentRef = fakeDocument(), windowRef = fakeWindow(); let busy = true; let calls = 0
  const controller = createAutoRefreshController({ refresh: () => { calls += 1; return true }, isBusy: () => busy, documentRef, windowRef, intervalMs: 15000, setTimeoutFn: timers.setTimeoutFn, clearTimeoutFn: timers.clearTimeoutFn })
  controller.start(); assert.equal(calls, 0); assert.equal(timers.size, 1); await timers.tick(15000); assert.equal(calls, 0); busy = false; await timers.tick(15000); await flush(); assert.equal(calls, 1); controller.stop()
})

test('failures back off to 30 seconds, then 60 seconds', async () => {
  const timers = fakeTimers(), documentRef = fakeDocument(), windowRef = fakeWindow(); let calls = 0
  const controller = createAutoRefreshController({ refresh: () => { calls += 1; throw new Error('temporary') }, documentRef, windowRef, intervalMs: 15000, failureDelayMs: 30000, maxFailureDelayMs: 60000, setTimeoutFn: timers.setTimeoutFn, clearTimeoutFn: timers.clearTimeoutFn })
  controller.start().catch(() => {}); await Promise.resolve(); await flush(); assert.equal(calls, 1); assert.equal(timers.size, 1); await timers.tick(29999); assert.equal(calls, 1); await timers.tick(1); await Promise.resolve(); await flush(); assert.equal(calls, 2); assert.equal(timers.size, 1); await timers.tick(59999); assert.equal(calls, 2); await timers.tick(1); await Promise.resolve(); await flush(); assert.equal(calls, 3); controller.stop()
})

test('disabled start/trigger can recover after switching to an enabled event', async () => {
  const timers = fakeTimers(), documentRef = fakeDocument(), windowRef = fakeWindow(); let enabled = false; let calls = 0
  const controller = createAutoRefreshController({ refresh: () => { calls += 1; return true }, isEnabled: () => enabled, documentRef, windowRef, intervalMs: 15000, setTimeoutFn: timers.setTimeoutFn, clearTimeoutFn: timers.clearTimeoutFn })
  controller.start(); await flush(); assert.equal(calls, 0); enabled = true; await controller.trigger(); assert.equal(calls, 1); enabled = false; await timers.tick(15000); assert.equal(calls, 1); enabled = true; await controller.start(); assert.equal(calls, 2); assert.equal(documentRef.listenerCount('visibilitychange'), 1); assert.equal(windowRef.listenerCount('focus'), 1); controller.stop(); controller.stop(); assert.equal(documentRef.listenerCount('visibilitychange'), 0); assert.equal(windowRef.listenerCount('focus'), 0)
})



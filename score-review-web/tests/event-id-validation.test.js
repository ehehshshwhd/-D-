'use strict'

const assert = require('node:assert/strict')
const { test } = require('node:test')
const { spawn } = require('node:child_process')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs')
const { validateEventId, isValidEventId } = require('../event-id')
const cloudStore = require('../cloud-store')

test('event IDs require a valid, non-truncated 1–80 character key', () => {
  for (const value of ['default', 'suiping', 'event-20261013-a1', 'x'.repeat(80)]) {
    assert.equal(validateEventId(value), value)
    assert.equal(cloudStore.validateEventId(value), value)
  }
  for (const value of [undefined, null, '', '   ', 'x'.repeat(81), 'a/b', '赛事']) {
    assert.equal(isValidEventId(value), false)
    assert.throws(() => cloudStore.validateEventId(value), /赛事 ID/)
  }
})

async function freePort() {
  const listener = net.createServer()
  await new Promise((resolve, reject) => listener.listen(0, '127.0.0.1', resolve).once('error', reject))
  const { port } = listener.address()
  await new Promise(resolve => listener.close(resolve))
  return port
}

test('HTTP work and public-results routes reject missing/oversized IDs and accept explicit default', async t => {
  const port = await freePort()
  const dataFile = path.join(os.tmpdir(), `score-review-event-id-${process.pid}-${Date.now()}.json`)
  const child = spawn(process.execPath, [path.resolve(__dirname, '..', 'server.js')], {
    env: { ...process.env, SCORE_REVIEW_CLOUDBASE_ENV: '', CBR_ENV_ID: '', SCORE_REVIEW_HOST: '127.0.0.1', SCORE_REVIEW_PORT: String(port), SCORE_REVIEW_PASSWORD: 'test-password', SCORE_REVIEW_SESSION_SECRET: 'test-secret', SCORE_REVIEW_DATA: dataFile },
    stdio: 'ignore'
  })
  t.after(() => {
    child.kill()
    try { fs.unlinkSync(dataFile) } catch {}
  })
  const base = `http://127.0.0.1:${port}`
  let health
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try { health = await fetch(`${base}/api/health`); break } catch { await new Promise(resolve => setTimeout(resolve, 50)) }
  }
  assert.ok(health, 'server should start')
  const login = await fetch(`${base}/api/session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'test-password' }) })
  assert.equal(login.status, 200)
  const cookie = login.headers.get('set-cookie').split(';')[0]
  const get = eventId => fetch(`${base}/api/work-records?${eventId == null ? '' : `eventId=${encodeURIComponent(eventId)}&`}stage=SS1`, { headers: { cookie } })
  const put = (eventId, duration) => fetch(`${base}/api/work-records`, { method: 'PUT', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ eventId, stage: 'SS1', expectedRevision: 0, rows: [{ carNumber: '1', segmentDuration: duration }] }) })
  assert.equal((await get(null)).status, 400)
  assert.equal((await get('x'.repeat(81))).status, 400)
  assert.equal((await get('default')).status, 200)
  assert.equal((await put(undefined, '0:01:00.000')).status, 400)
  assert.equal((await put('x'.repeat(81), '0:01:00.000')).status, 400)
  assert.equal((await put('event-A', '0:01:00.000')).status, 200)
  assert.equal((await put('event-B', '0:02:00.000')).status, 200)
  assert.equal((await (await fetch(`${base}/api/work-records?eventId=event-A&stage=SS10`, { headers: { cookie } })).json()).ok, true)
  assert.equal((await (await fetch(`${base}/api/work-records?eventId=event-A&stage=SS20`, { headers: { cookie } })).json()).ok, true)
  assert.equal((await fetch(`${base}/api/work-records?eventId=event-A&stage=SS21`, { headers: { cookie } })).status, 400)
  assert.equal((await (await get('event-A')).json()).rows[0].segmentDuration, '0:01:00.000')
  assert.equal((await (await get('event-B')).json()).rows[0].segmentDuration, '0:02:00.000')
  assert.deepEqual((await (await get('default')).json()).rows, [])
  assert.equal((await fetch(`${base}/api/public/results`)).status, 400)
  assert.equal((await fetch(`${base}/api/public/results?eventId=${'x'.repeat(81)}`)).status, 400)
  assert.equal((await fetch(`${base}/api/public/results?eventId=default`)).status, 200)
})

test('cloud store rejects invalid work/result/event IDs before any database access', async () => {
  for (const eventId of [undefined, '', 'x'.repeat(81), 'a/b']) {
    await assert.rejects(cloudStore.get(eventId, 'SS1'), /赛事 ID/)
    await assert.rejects(cloudStore.put(eventId, 'SS1', [], 0), /赛事 ID/)
    await assert.rejects(cloudStore.getPublishedResults(eventId), /赛事 ID/)
    await assert.rejects(cloudStore.publishResults(eventId, []), /赛事 ID/)
  }
  await assert.rejects(cloudStore.saveEvent({ id: 'x'.repeat(81) }), /赛事 ID/)
})

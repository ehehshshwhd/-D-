'use strict'

const assert = require('node:assert/strict')
const { test } = require('node:test')
const { spawn } = require('node:child_process')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs')

async function freePort() {
  const listener = net.createServer()
  await new Promise((resolve, reject) => listener.listen(0, '127.0.0.1', resolve).once('error', reject))
  const port = listener.address().port
  await new Promise(resolve => listener.close(resolve))
  return port
}

async function startServer(t) {
  const port = await freePort()
  const dataFile = path.join(os.tmpdir(), `score-review-delete-${process.pid}-${Date.now()}.json`)
  const child = spawn(process.execPath, [path.resolve(__dirname, '..', 'server.js')], {
    env: { ...process.env, SCORE_REVIEW_CLOUDBASE_ENV: '', CBR_ENV_ID: '', SCORE_REVIEW_HOST: '127.0.0.1', SCORE_REVIEW_PORT: String(port), SCORE_REVIEW_PASSWORD: 'test-password', SCORE_REVIEW_SESSION_SECRET: 'test-secret', SCORE_REVIEW_DATA: dataFile },
    stdio: 'ignore'
  })
  t.after(() => { child.kill(); try { fs.unlinkSync(dataFile) } catch {} })
  const base = `http://127.0.0.1:${port}`
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try { await fetch(`${base}/api/health`); break } catch { await new Promise(resolve => setTimeout(resolve, 50)) }
  }
  return base
}

test('delete event route requires the admin session and rejects non-event IDs before CloudBase access', async t => {
  const base = await startServer(t)
  const noSession = await fetch(`${base}/api/events`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ eventId: 'event-1' }) })
  assert.equal(noSession.status, 401)

  const login = await fetch(`${base}/api/session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'test-password' }) })
  assert.equal(login.status, 200)
  const cookie = login.headers.get('set-cookie').split(';')[0]
  const remove = eventId => fetch(`${base}/api/events`, { method: 'DELETE', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ eventId }) })

  for (const eventId of ['', 'preview', 'default', 'bad/id']) {
    const response = await remove(eventId)
    assert.equal(response.status, 400)
    assert.match((await response.json()).message, /真实的云端赛事|赛事 ID 无效/)
  }
  const unavailable = await remove('event-1')
  assert.equal(unavailable.status, 503)
  assert.match((await unavailable.json()).message, /CloudBase/)
})

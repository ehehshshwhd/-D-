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
  const { port } = listener.address()
  await new Promise(resolve => listener.close(resolve))
  return port
}

test('application data is authenticated, persisted, and protected by revision checks', async t => {
  const port = await freePort()
  const dataFile = path.join(os.tmpdir(), `score-review-app-data-${process.pid}-${Date.now()}.json`)
  const child = spawn(process.execPath, [path.resolve(__dirname, '..', 'server.js')], {
    env: { ...process.env, SCORE_REVIEW_CLOUDBASE_ENV: '', CBR_ENV_ID: '', SCORE_REVIEW_HOST: '127.0.0.1', SCORE_REVIEW_PORT: String(port), SCORE_REVIEW_PASSWORD: 'test-password', SCORE_REVIEW_SESSION_SECRET: 'test-secret', SCORE_REVIEW_DATA: dataFile },
    stdio: 'ignore'
  })
  t.after(() => { child.kill(); try { fs.unlinkSync(dataFile) } catch {} })
  const base = `http://127.0.0.1:${port}`
  let health
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try { health = await fetch(`${base}/api/health`); break } catch { await new Promise(resolve => setTimeout(resolve, 50)) }
  }
  assert.ok(health, 'server should start')
  assert.equal((await fetch(`${base}/api/app-data`)).status, 401)
  const login = await fetch(`${base}/api/session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'test-password' }) })
  const cookie = login.headers.get('set-cookie').split(';')[0]
  const put = (value, expectedRevision = 0, key = 'shop-stores') => fetch(`${base}/api/app-data`, { method: 'PUT', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ key, value, expectedRevision }) })
  assert.equal((await put([{ id: 'store-1', name: '赛事用品' }])).status, 200)
  assert.equal((await put([{ id: 'store-2' }])).status, 409)
  assert.equal((await put(['next'], 1)).status, 200)
  assert.equal((await put(null, 2, '__proto__')).status, 400)
  const data = await (await fetch(`${base}/api/app-data`, { headers: { cookie } })).json()
  assert.deepEqual(data.items['shop-stores'].value, ['next'])
  assert.equal(data.items['shop-stores'].revision, 2)
})

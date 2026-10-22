'use strict'

const assert = require('node:assert/strict')
const { test } = require('node:test')
const { spawn } = require('node:child_process')
const net = require('node:net')

async function freePort() {
  const listener = net.createServer()
  await new Promise((resolve, reject) => listener.listen(0, '127.0.0.1', resolve).once('error', reject))
  const { port } = listener.address()
  await new Promise(resolve => listener.close(resolve))
  return port
}

test('root full-system page loads its score-review adapter from the served asset path', async t => {
  const port = await freePort()
  const child = spawn(process.execPath, [require.resolve('../server.js')], {
    env: { ...process.env, SCORE_REVIEW_CLOUDBASE_ENV: '', CBR_ENV_ID: '', SCORE_REVIEW_HOST: '127.0.0.1', SCORE_REVIEW_PORT: String(port), SCORE_REVIEW_PASSWORD: 'test-password', SCORE_REVIEW_SESSION_SECRET: 'test-secret' },
    stdio: 'ignore'
  })
  t.after(() => child.kill())

  const base = `http://127.0.0.1:${port}`
  let page
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try { page = await fetch(base); break } catch { await new Promise(resolve => setTimeout(resolve, 50)) }
  }

  assert.ok(page, 'server should start')
  assert.equal(page.status, 200)
  const html = await page.text()
  assert.match(html, /src="\/full-system\/score-review-cloud\.js"/)

  const adapter = await fetch(`${base}/full-system/score-review-cloud.js`)
  assert.equal(adapter.status, 200)
  assert.match(await adapter.text(), /async function loadRows/)
})

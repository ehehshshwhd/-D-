'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const source = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8')
const match = source.match(/^\s*(async function cloudFetchWithRetry\([\s\S]*?^  \})/m)
assert.ok(match, 'production cloudFetchWithRetry helper must exist')
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

async function run(handler, method = 'GET') {
  const context = { setTimeout, Promise, Set, String, Number }
  vm.runInNewContext(`${match[1]}\nglobalThis.runRetry = cloudFetchWithRetry`, context)
  return context.runRetry(handler, method)
}

async function main() {
  let attempts = 0
  const recovered = await run(async () => {
    attempts++
    if (attempts === 1) throw new Error('network connection reset')
    return { status: 200 }
  })
  assert.equal(recovered.status, 200)
  assert.equal(attempts, 2, 'GET should retry a transient network error')

  attempts = 0
  await run(async () => ({ status: ++attempts < 3 ? 503 : 200 }))
  assert.equal(attempts, 3, 'GET should retry transient gateway errors at most twice')

  attempts = 0
  const unauthorized = await run(async () => ({ status: ++attempts === 1 ? 401 : 200 }))
  assert.equal(unauthorized.status, 401)
  assert.equal(attempts, 1, '401 must be returned immediately for the login flow')

  attempts = 0
  await assert.rejects(() => run(async () => { attempts++; throw new Error('network connection reset') }, 'POST'))
  assert.equal(attempts, 1, 'writes must never be retried automatically')

  console.log('cloud request retry tests passed')
}

main().catch(error => {
  console.error(error.stack || error)
  process.exitCode = 1
})
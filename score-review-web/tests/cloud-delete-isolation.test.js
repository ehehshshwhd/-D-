'use strict'

const assert = require('node:assert/strict')
const { test } = require('node:test')
const { spawnSync } = require('node:child_process')
const path = require('node:path')

test('cloud delete updates exactly one event and preserves another event records', () => {
  const script = String.raw`
    process.env.SCORE_REVIEW_CLOUDBASE_ENV = 'test-env'
    const Module = require('node:module')
    const records = [
      { _id: 'doc-a', id: 'event-a', title: 'A', published: true },
      { _id: 'doc-b', id: 'event-b', title: 'B', published: true }
    ]
    const collection = name => ({
      limit() { return this },
      skip() { return this },
      where(filter) { this.filter = filter; return this },
      get: async function () {
        if (name === 'events' && this.filter && this.filter.id) return { data: records.filter(item => item.id === this.filter.id) }
        return { data: name === 'events' ? records.slice() : [] }
      },
      doc(id) { return { update: async patch => { const item = records.find(record => record._id === id); Object.assign(item, patch) } } }
    })
    const db = { collection, createCollection: async () => {} }
    const originalLoad = Module._load
    Module._load = function (request, parent, isMain) {
      if (request === '@cloudbase/node-sdk') return { init: () => ({ database: () => db }) }
      return originalLoad.call(this, request, parent, isMain)
    }
    const store = require(${JSON.stringify(path.resolve(__dirname, '..', 'cloud-store.js'))})
    store.deleteEvent('event-a').then(result => {
      if (!result.deleted || records[0].published !== false || !records[0].deletedAt || records[1].deletedAt) throw new Error('event isolation failed')
      return store.deleteEvent('preview').then(() => { throw new Error('placeholder accepted') }, error => {
        if (!/赛事 ID/.test(error.message)) throw error
        process.stdout.write(JSON.stringify({ ok: true, id: result.id }))
      })
    }).catch(error => { console.error(error); process.exitCode = 1 })
  `
  const result = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout), { ok: true, id: 'event-a' })
})


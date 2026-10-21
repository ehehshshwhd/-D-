'use strict'

const assert = require('node:assert/strict')
const { test } = require('node:test')
const path = require('node:path')

test('CloudBase event data tolerates an empty document and null query records', async () => {
  const records = new Map()
  const doc = id => ({
    get: async () => ({ data: records.get(id) || null }),
    set: async value => { records.set(id, { _id: id, ...value }) },
    update: async value => { records.set(id, { ...records.get(id), ...value }) }
  })
  const collection = {
    limit: () => ({ get: async () => ({ data: [] }) }),
    where: () => ({ skip: () => ({ limit: () => ({ get: async () => ({ data: [null, ...records.values()] }) }) }) }),
    doc
  }
  const db = {
    collection: () => collection,
    createCollection: async () => {},
    runTransaction: async callback => callback({ collection: () => collection })
  }

  process.env.SCORE_REVIEW_CLOUDBASE_ENV = 'test-env'
  const sdkPath = require.resolve('@cloudbase/node-sdk', { paths: [path.resolve(__dirname, '..')] })
  require.cache[sdkPath] = { id: sdkPath, filename: sdkPath, loaded: true, exports: { init: () => ({ database: () => db }) } }
  const storePath = require.resolve('../cloud-store')
  delete require.cache[storePath]
  const store = require('../cloud-store')

  const saved = await store.putEventData('event-a', 'signup-event-a', [{ name: '公开组' }], 0)
  assert.equal(saved.revision, 1)
  assert.equal(saved.verified, true)
  const listed = await store.listEventData('event-a')
  assert.equal(listed.items['signup-event-a'].revision, 1)
  assert.deepEqual(listed.items['signup-event-a'].value, [{ name: '公开组' }])
})

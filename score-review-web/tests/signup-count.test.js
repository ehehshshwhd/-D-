'use strict'

const assert = require('node:assert/strict')
const { test } = require('node:test')
const path = require('node:path')

test('event registration and signup-count visibility survive cloud save, public read and disabling again', async () => {
  const records = new Map()
  const collection = {
    limit: () => ({ get: async () => ({ data: [...records.values()] }) }),
    skip: offset => ({ limit: size => ({ get: async () => ({ data: [...records.values()].slice(offset, offset + size) }) }) }),
    where: filter => ({ limit: () => ({ get: async () => ({ data: [...records.values()].filter(record => record.id === filter.id) }) }) }),
    doc: id => ({
      get: async () => ({ data: records.get(id) || null }),
      set: async value => { records.set(id, { _id: id, ...value }) },
      update: async value => { records.set(id, { ...records.get(id), ...value }) }
    }),
    add: async value => { records.set(value.id, { _id: value.id, ...value }) }
  }
  const db = { collection: () => collection }
  process.env.SCORE_REVIEW_CLOUDBASE_ENV = 'test-env'
  const sdkPath = require.resolve('@cloudbase/node-sdk', { paths: [path.resolve(__dirname, '..')] })
  require.cache[sdkPath] = { id: sdkPath, filename: sdkPath, loaded: true, exports: { init: () => ({ database: () => db }) } }
  delete require.cache[require.resolve('../cloud-store')]
  const store = require('../cloud-store')
  const event = { id: 'signup-test', title: '测试赛事', dateStart: '2026-10-31', dateEnd: '2026-11-02', location: '资兴市', contentBlocks: [], published: true }
  assert.equal((await store.saveEvent(event)).hideSignupCount, false)
  assert.equal(records.get(event.id).registrationEnabled, false)
  for (const hidden of [true, false]) {
    const saved = await store.saveEvent({ ...event, hideSignupCount: hidden, registrationEnabled: hidden })
    assert.equal(saved.hideSignupCount, hidden)
    assert.equal(saved.registrationEnabled, hidden)
    assert.equal(records.get(event.id).hideSignupCount, hidden)
    assert.equal(records.get(event.id).registrationEnabled, hidden)
    assert.equal((await store.listEvents({ publishedOnly: true }))[0].hideSignupCount, hidden)
    assert.equal((await store.listEvents({ publishedOnly: true }))[0].registrationEnabled, hidden)
  }
  for (const invalid of ['false', 'true', 1, {}, []]) {
    assert.throws(() => store.validateEventInput({ ...event, hideSignupCount: invalid }), /隐藏报名人数必须是布尔值/)
    assert.throws(() => store.validateEventInput({ ...event, registrationEnabled: invalid }), /开启报名必须是布尔值/)
  }
})

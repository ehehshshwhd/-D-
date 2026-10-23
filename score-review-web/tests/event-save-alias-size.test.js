'use strict'

const assert = require('node:assert/strict')
const path = require('node:path')
const { test } = require('node:test')

function loadStore(records) {
  const collection = {
    limit: () => ({ get: async () => ({ data: [...records.values()] }) }),
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
  const storePath = require.resolve('../cloud-store')
  delete require.cache[storePath]
  return require('../cloud-store')
}

test('saving a legacy editor payload does not count duplicate UI aliases toward the document limit', async () => {
  const records = new Map()
  const store = loadStore(records)
  const detailPageHtml = `<p>${'赛'.repeat(200_000)}</p>`
  const payload = {
    id: 'legacy-alias-size-test',
    title: '详情大小测试',
    dateStart: '2026-10-31',
    dateEnd: '2026-11-02',
    location: '资兴市',
    contentBlocks: [],
    detailPageHtml,
    content: detailPageHtml,
    form: { title: '详情大小测试', city: '资兴市' },
    dates: { start: '2026-10-31', end: '2026-11-02' },
    img: 'data:image/png;base64,' + 'A'.repeat(200_000),
    published: false,
    saveMode: 'draft'
  }

  const saved = await store.saveEvent(payload)
  assert.equal(saved.detailPageHtml, detailPageHtml)
  assert.equal(Object.hasOwn(records.get(payload.id), 'content'), false)
  assert.equal(Object.hasOwn(records.get(payload.id), 'form'), false)
  assert.equal(Object.hasOwn(records.get(payload.id), 'dates'), false)
  assert.equal(Object.hasOwn(records.get(payload.id), 'img'), false)
})

test('a successful draft save replaces the old draft and its UI copies without touching another event', async () => {
  const previous = {
    _id: 'draft-document', id: 'draft-test', title: '旧草稿',
    detailPageHtml: '<p>旧正文</p>', content: '旧正文'.repeat(200_000),
    form: { title: '旧草稿' }, dates: { start: '2026-10-01' }, img: '旧封面副本',
    customSetting: 'keep', published: false, createdAt: new Date('2026-10-01')
  }
  const other = { _id: 'other-document', id: 'other-event', title: '其他赛事' }
  const records = new Map([[previous._id, previous], [other._id, other]])
  const store = loadStore(records)
  const saved = await store.saveEvent({ id: previous.id, title: '新草稿', detailPageHtml: '<p>新正文</p>', contentBlocks: [], saveMode: 'draft', published: false })

  assert.equal(records.size, 2)
  assert.equal(saved.id, previous.id)
  assert.equal(saved.detailPageHtml, '<p>新正文</p>')
  assert.equal(records.get(previous._id).customSetting, 'keep')
  assert.equal(records.get(previous._id).createdAt.toISOString(), previous.createdAt.toISOString())
  for (const key of ['content', 'form', 'dates', 'img']) assert.equal(Object.hasOwn(records.get(previous._id), key), false)
  assert.deepEqual(records.get(other._id), other)
  const confirmed = records.get(previous._id)
  await assert.rejects(store.saveEvent({ id: previous.id, title: '超限草稿', detailPageHtml: '赛'.repeat(250_000), saveMode: 'draft' }), /安全大小/)
  assert.equal(records.get(previous._id), confirmed, 'failed saves must leave the last saved draft intact')
})

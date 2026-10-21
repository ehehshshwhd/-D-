// Regression test for CloudBase transactions: transaction collections expose
// doc(id), but do not support where/orderBy.  Keep this test dependency-free.
const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

function loadFunction(file, extraExport) {
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8')
  const module = { exports: {} }
  const holder = { db: null }
  const dbProxy = {
    collection: (...args) => holder.db.collection(...args),
    runTransaction: (...args) => holder.db.runTransaction(...args),
    createCollection: (...args) => holder.db.createCollection(...args)
  }
  const context = {
    module,
    exports: module.exports,
    require: name => name === 'wx-server-sdk' ? context.cloud : require(name),
    console,
    Buffer,
    process,
    setTimeout,
    clearTimeout,
    cloud: null
  }
  context.cloud = {
    DYNAMIC_CURRENT_ENV: 'test',
    init() {},
    database: () => dbProxy
  }
  vm.runInNewContext(`${source}\nmodule.exports.__test = ${extraExport}`, context, { filename: file })
  return { api: module.exports.__test, setDatabase: db => { holder.db = db } }
}

function makeDatabase({ eventId = 'event-1', stage = 'SS1', initial = null } = {}) {
  const docs = new Map()
  const id = `work_${eventId}_${stage}`
  if (initial) docs.set(id, { ...initial, _id: id })
  let transactionWhereCalled = false
  const users = [{ _id: 'user-1', openid: 'openid-1', phoneNumber: '13729912574' }]
  const normalCollection = name => ({
    where(query) {
      if (name === 'users' && query.openid === 'openid-1') return { limit: () => ({ get: async () => ({ data: users }) }) }
      if (name === 'work_records') {
        const matches = [...docs.values()].filter(item => Object.entries(query).every(([key, value]) => item[key] === value))
        const result = { data: matches }
        const queryApi = {
          orderBy: () => queryApi,
          limit: count => ({ get: async () => ({ data: matches.slice(0, count) }) }),
          get: async () => result
        }
        return queryApi
      }
      throw new Error(`unexpected query on ${name}`)
    },
    limit: () => ({ get: async () => ({ data: [] }) })
  })
  const docCollection = {
    where() { transactionWhereCalled = true; throw new Error('transaction.where is unsupported') },
    doc(docId) {
      return {
        async get() {
          const value = docs.get(docId)
          if (!value) throw new Error('document not found')
          return { data: { ...value } }
        },
        async set({ data }) { docs.set(docId, { ...data, _id: docId }) },
        async update({ data }) { docs.set(docId, { ...(docs.get(docId) || {}), ...data, _id: docId }) }
      }
    }
  }
  return {
    collection: name => normalCollection(name),
    async runTransaction(callback) {
      const transaction = { collection: () => docCollection }
      return callback(transaction)
    },
    transactionUsedWhere: () => transactionWhereCalled,
    docs
  }
}

test('account saveWorkRecordsAtomic uses doc-only transaction reads and writes', async () => {
  const loaded = loadFunction('account/index.js', '{ saveWorkRecordsAtomic, expectedWorkRevision }')
  const db = makeDatabase()
  loaded.setDatabase(db)
  const result = await loaded.api.saveWorkRecordsAtomic({
    eventId: 'event-1',
    records: [{ stage: 'SS1', expectedRevision: 0, rows: [{ carNumber: '1' }] }],
    openid: 'openid-1',
    access: { role: 'staff' }
  })
  assert.equal(result[0].revision, 1)
  assert.equal(db.transactionUsedWhere(), false)
  assert.throws(() => loaded.api.expectedWorkRevision(null))
})

test('web API putRecords uses doc-only transaction reads and writes', async () => {
  const loaded = loadFunction('web-api/index.js', '{ putRecords }')
  const db = makeDatabase()
  loaded.setDatabase(db)
  const result = await loaded.api.putRecords({ body: JSON.stringify({ eventId: 'event-1', stage: 'SS1', expectedRevision: 0, rows: [{ carNumber: '1' }] }) })
  assert.equal(result.statusCode, 200)
  assert.equal(db.transactionUsedWhere(), false)
})

test('work score cloud functions reject missing, malformed, and overlong event IDs without default fallback', async () => {
  const account = loadFunction('account/index.js', '{ validateEventId, getWorkRecords, saveWorkRecords, uploadAllWorkRecords }').api
  const webApi = loadFunction('web-api/index.js', '{ validateEventId, getRecords, putRecords }').api
  for (const invalid of [undefined, '', 'x'.repeat(81), 'bad/id', '赛事']) {
    assert.throws(() => account.validateEventId(invalid), /赛事 ID/)
    assert.throws(() => webApi.validateEventId(invalid), /赛事 ID/)
    await assert.rejects(account.getWorkRecords({ eventId: invalid, stage: 'SS1' }, 'openid-1'), /赛事 ID/)
    await assert.rejects(account.saveWorkRecords({ eventId: invalid, stage: 'SS1', rows: [] }, 'openid-1'), /赛事 ID/)
    await assert.rejects(account.uploadAllWorkRecords({ eventId: invalid, records: [] }, 'openid-1'), /赛事 ID/)
    await assert.rejects(webApi.getRecords({ queryStringParameters: { eventId: invalid, stage: 'SS1' } }), /赛事 ID/)
    await assert.rejects(webApi.putRecords({ body: JSON.stringify({ eventId: invalid, stage: 'SS1', expectedRevision: 0, rows: [] }) }), /赛事 ID/)
  }
  for (const valid of ['default', 'suiping', 'event-20261013-a1', 'x'.repeat(80)]) {
    assert.equal(account.validateEventId(valid), valid)
    assert.equal(webApi.validateEventId(valid), valid)
  }
})

test('account and web API keep the same car and stage independent between events', async () => {
  const account = loadFunction('account/index.js', '{ getWorkRecords, saveWorkRecords }')
  const webApi = loadFunction('web-api/index.js', '{ getRecords, putRecords }')
  const db = makeDatabase()
  account.setDatabase(db)
  webApi.setDatabase(db)
  await account.api.saveWorkRecords({ eventId: 'event-A', stage: 'SS1', expectedRevision: 0, rows: [{ carNumber: '1', segmentDuration: '0:01:00.000' }] }, 'openid-1')
  await webApi.api.putRecords({ body: JSON.stringify({ eventId: 'event-B', stage: 'SS1', expectedRevision: 0, rows: [{ carNumber: '1', segmentDuration: '0:02:00.000' }] }) })
  const first = await account.api.getWorkRecords({ eventId: 'event-A', stage: 'SS1' }, 'openid-1')
  const second = JSON.parse((await webApi.api.getRecords({ queryStringParameters: { eventId: 'event-B', stage: 'SS1' } })).body)
  assert.equal(first.rows[0].segmentDuration, '0:01:00.000')
  assert.equal(second.rows[0].segmentDuration, '0:02:00.000')
  assert.equal(db.docs.size, 2)
  assert.equal((await account.api.getWorkRecords({ eventId: 'default', stage: 'SS1' }, 'openid-1')).rows.length, 0)
})

test('SS10 and SS20 are accepted while SS21 is rejected by both work backends', async () => {
  const account = loadFunction('account/index.js', '{ getWorkRecords, saveWorkRecords }')
  const webApi = loadFunction('web-api/index.js', '{ getRecords, putRecords }')
  const db = makeDatabase()
  account.setDatabase(db)
  webApi.setDatabase(db)
  await account.api.saveWorkRecords({ eventId: 'event-stage-10', stage: 'SS10', expectedRevision: 0, rows: [{ carNumber: '10' }] }, 'openid-1')
  const ss20 = await webApi.api.putRecords({ body: JSON.stringify({ eventId: 'event-stage-20', stage: 'SS20', expectedRevision: 0, rows: [{ carNumber: '20' }] }) })
  assert.equal(ss20.statusCode, 200)
  await assert.rejects(account.api.getWorkRecords({ eventId: 'event-stage-10', stage: 'SS21' }, 'openid-1'), /无效的赛段/)
  assert.equal((await webApi.api.getRecords({ queryStringParameters: { eventId: 'event-stage-20', stage: 'SS21' } })).statusCode, 400)
  await assert.rejects(webApi.api.putRecords({ body: JSON.stringify({ eventId: 'event-stage-20', stage: 'SS21', expectedRevision: 0, rows: [] }) }), /赛段/)
})

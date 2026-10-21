'use strict'

const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { createRequire } = require('node:module')

function createStore() {
  const docs = new Map([
    ['events', new Map([['event-doc', { _id: 'event-doc', id: 'event-20', title: '测试赛事', stageNames: ['SS10', 'SS20'], groups: ['A'], visibleGroups: ['A'], groupStageNames: { A: ['SS10', 'SS20'] } }]])],
    ['work_records', new Map()], ['published_results', new Map()]
  ])
  const collection = name => {
    const map = docs.get(name)
    const query = (filter = {}) => ({
      orderBy() { return this }, limit() { return this },
      async get() { return { data: [...map.values()].filter(item => Object.entries(filter).every(([key, value]) => item[key] === value)) } }
    })
    return {
      limit: () => query(), where: query,
      async add(data) { const id = `${name}-${map.size}`; map.set(id, { ...data, _id: id }); return { id } },
      doc(id) {
        return {
          async get() { if (!map.has(id)) throw new Error('document not found'); return { data: { ...map.get(id) } } },
          async update(data) { map.set(id, { ...map.get(id), ...data, _id: id }) },
          async set(data) { map.set(id, { ...data, _id: id }) }
        }
      }
    }
  }
  const database = { collection, runTransaction: callback => callback({ collection }) }
  const file = path.resolve(__dirname, '..', 'cloud-store.js')
  const requireLocal = createRequire(file)
  const module = { exports: {} }
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    module, exports: module.exports, console, Buffer,
    process: { env: { SCORE_REVIEW_CLOUDBASE_ENV: 'test' } },
    require: name => name === '@cloudbase/node-sdk' ? { init: () => ({ database: () => database }) } : requireLocal(name)
  }, { filename: file })
  return { store: module.exports, docs }
}

test('SS10 and SS20 scores survive CloudBase storage and publication; SS21 is refused', async () => {
  const { store, docs } = createStore()
  for (const [stage, duration] of [['SS10', '0:01:00.000'], ['SS20', '0:02:00.000']]) {
    const saved = await store.put('event-20', stage, [{ carNumber: '1', group: 'A', status: 'approved', segmentDuration: duration }], 0)
    assert.equal(saved.verified, true)
    assert.equal((await store.get('event-20', stage)).rows[0].segmentDuration, duration)
  }
  const published = await store.publishResults('event-20', ['A'], 'total', { A: ['SS10', 'SS20'] })
  assert.deepEqual(JSON.parse(JSON.stringify(published.stageNames)), ['SS10', 'SS20'])
  assert.equal(published.rows[0].stageTimes.SS10.duration, '0:01:00.000')
  assert.equal(published.rows[0].stageTimes.SS20.duration, '0:02:00.000')
  assert.equal(published.rows[0].totalScore, '0:03:00.000')
  const readback = await store.getPublishedResults('event-20')
  assert.equal(readback.rows[0].stageTimes.SS20.duration, '0:02:00.000')
  const snapshotsBefore = JSON.stringify([...docs.get('published_results').values()])
  await assert.rejects(store.get('event-20', 'SS21'), /赛段无效/)
  await assert.rejects(store.put('event-20', 'SS21', [], 0), /赛段无效/)
  await assert.rejects(store.publishResults('event-20', ['A'], 'total', { A: ['SS21'] }), /发布赛段无效/)
  assert.equal(JSON.stringify([...docs.get('published_results').values()]), snapshotsBefore)
})

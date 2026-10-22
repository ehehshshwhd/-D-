'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const adapter = require('../../full-system/score-review-cloud.js')

test('maps a cloud score into the full-system editor fields and back without losing its timing', () => {
  const uiRow = adapter.fromCloudRow({
    id: 'record-23-ss1',
    carNumber: ' 23 ',
    group: '公开组',
    startTime: '12:34:14.14',
    endTime: '12:37:12.41',
    penaltyTotal: '2.5',
    segmentDuration: '0:02:58.270',
    status: 'approved',
    note: '已核对',
    uploader: '裁判员',
    uploadedAt: '2026-10-22T02:00:00.000Z'
  }, 'SS1')

  assert.equal(uiRow.number, '23')
  assert.equal(uiRow.time, 178.27)
  assert.equal(uiRow.status, '已通过')
  assert.equal(uiRow.reason, '已核对')

  const cloudRow = adapter.toCloudRow(uiRow)
  assert.equal(cloudRow.carNumber, '23')
  assert.equal(cloudRow.segmentDuration, '0:02:58.270')
  assert.equal(cloudRow.penaltyTotal, '2.5')
  assert.equal(cloudRow.status, 'approved')
  assert.equal(cloudRow.note, '已核对')
})

test('normalizes old cloud status and duration fields while keeping invalid time empty', () => {
  const uiRow = adapter.fromCloudRow({ car: 'a-01', duration: 'bad', status: 'returned' }, 'SS20')

  assert.equal(uiRow.number, 'A01')
  assert.equal(uiRow.stage, 'SS20')
  assert.equal(uiRow.time, null)
  assert.equal(uiRow.status, '已退回')
})

test('loads every stage only after cloud health and admin session are verified', async () => {
  const calls = []
  const fetcher = async (url, options) => {
    calls.push({ url, options })
    if (url.endsWith('/api/health')) return { ok: true, json: async () => ({ ok: true, cloudEnabled: true, cloudDatabaseConnected: true }) }
    if (url.endsWith('/api/session')) return { ok: true, json: async () => ({ ok: true }) }
    const stage = new URL(url).searchParams.get('stage')
    return { ok: true, json: async () => ({ ok: true, rows: stage === 'SS1' ? [{ carNumber: '23', segmentDuration: '0:01:00.000' }] : [], count: stage === 'SS1' ? 1 : 0, revision: 0 }) }
  }

  const result = await adapter.loadRows({ fetcher, apiUrl: 'https://race.example/', eventId: 'event-1' })

  assert.equal(result.rows.length, 1)
  assert.equal(result.rows[0].number, '23')
  assert.equal(result.revisions.SS20, 0)
  assert.equal(calls.filter(call => call.url.includes('/api/work-records?')).length, 20)
  assert.ok(calls.every(call => call.options.credentials === 'include'))
})

test('rejects null cloud revisions instead of reporting a connected but unusable result page', async () => {
  const fetcher = async url => {
    if (url.endsWith('/api/health')) return { ok: true, json: async () => ({ ok: true, cloudEnabled: true, cloudDatabaseConnected: true }) }
    if (url.endsWith('/api/session')) return { ok: true, json: async () => ({ ok: true }) }
    const stage = new URL(url).searchParams.get('stage')
    return { ok: true, json: async () => ({ ok: true, rows: [], count: 0, revision: stage === 'SS1' ? null : 0 }) }
  }

  await assert.rejects(adapter.loadRows({ fetcher, apiUrl: 'https://race.example', eventId: 'event-1' }), /SS1 云端版本号无效/)
})

test('saves a verified revisioned snapshot and publishes through the mini-program endpoint', async () => {
  const calls = []
  const fetcher = async (url, options) => {
    calls.push({ url, options })
    if (url.endsWith('/api/work-records')) return { ok: true, json: async () => ({ ok: true, count: 1, revision: 4 }) }
    return { ok: true, json: async () => ({ ok: true, rowCount: 1 }) }
  }
  const row = { number: '23', stage: 'SS1', time: 60, status: '已通过' }

  const revision = await adapter.saveStage({ fetcher, apiUrl: 'https://race.example', eventId: 'event-1', stage: 'SS1', rows: [row], expectedRevision: 3 })
  const published = await adapter.publish({ fetcher, apiUrl: 'https://race.example', eventId: 'event-1', visibleGroups: ['公开组'], groupStageNames: { '公开组': ['SS1'] } })
  const saveBody = JSON.parse(calls[0].options.body)
  const publishBody = JSON.parse(calls[1].options.body)

  assert.equal(revision, 4)
  assert.equal(saveBody.rows[0].carNumber, '23')
  assert.equal(saveBody.expectedRevision, 3)
  assert.equal(publishBody.rankingMode, 'total')
  assert.deepEqual(published, { ok: true, rowCount: 1 })
})

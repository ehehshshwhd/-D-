// Focused authorization regression tests for the account work-record APIs.
// The harness intentionally models only the CloudBase collection operations
// used by account/index.js, so these tests run without a CloudBase connection.
const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

function loadAccount() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'account', 'index.js'), 'utf8')
  const module = { exports: {} }
  const holder = { db: null }
  const dbProxy = {
    collection: (...args) => holder.db.collection(...args),
    createCollection: (...args) => holder.db.createCollection(...args),
    runTransaction: (...args) => holder.db.runTransaction(...args)
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
  vm.runInNewContext(
    `${source}\nmodule.exports.__test = { getWorkRecords, saveWorkRecords, uploadAllWorkRecords, eventStats, recordEventView, ensureCollection, resolveRole }`,
    context,
    { filename: 'account/index.js' }
  )
  return {
    api: module.exports.__test,
    setDatabase: db => { holder.db = db }
  }
}

function makeDatabase({ users = [], admins = [], staff = [] } = {}) {
  const collections = new Map()
  const seed = (name, values) => {
    const map = new Map()
    values.forEach((value, index) => {
      const id = String(value._id || `${name}-${index + 1}`)
      map.set(id, { ...value, _id: id })
    })
    collections.set(name, map)
  }
  seed('users', users)
  seed('admin_users', admins)
  seed('staff_users', staff)
  seed('work_records', [])
  seed('work_uploads', [])

  const matches = (value, query) => Object.entries(query || {}).every(([key, expected]) => value[key] === expected)
  const mapFor = name => {
    if (!collections.has(name)) collections.set(name, new Map())
    return collections.get(name)
  }
  const chain = (name, query = null, limitValue = null, order = null) => ({
    orderBy(field, direction) {
      return chain(name, query, limitValue, { field, direction })
    },
    limit(value) {
      return chain(name, query, value, order)
    },
    async get() {
      let data = [...mapFor(name).values()].filter(item => !query || matches(item, query))
      if (order) {
        const multiplier = String(order.direction).toLowerCase() === 'asc' ? 1 : -1
        data.sort((left, right) => {
          const a = left[order.field] instanceof Date ? left[order.field].getTime() : left[order.field]
          const b = right[order.field] instanceof Date ? right[order.field].getTime() : right[order.field]
          return (a > b ? 1 : a < b ? -1 : 0) * multiplier
        })
      }
      if (Number.isInteger(limitValue)) data = data.slice(0, limitValue)
      return { data }
    },
    async count() {
      const result = await chain(name, query, null, order).get()
      return { total: result.data.length }
    }
  })
  const collection = name => ({
    where(query) {
      return chain(name, query)
    },
    limit(value) {
      return chain(name, null, value)
    },
    orderBy(field, direction) {
      return chain(name, null, null, { field, direction })
    },
    doc(id) {
      const map = mapFor(name)
      return {
        async get() {
          if (!map.has(id)) throw new Error('document not found')
          return { data: { ...map.get(id) } }
        },
        async set({ data }) {
          map.set(id, { ...data, _id: id })
          return { _id: id }
        },
        async update({ data }) {
          map.set(id, { ...(map.get(id) || {}), ...data, _id: id })
          return { _id: id }
        },
        async remove() {
          map.delete(id)
        }
      }
    },
    async add({ data }) {
      const id = `${name}-${mapFor(name).size + 1}`
      mapFor(name).set(id, { ...data, _id: id })
      return { _id: id }
    }
  })

  return {
    collection,
    async createCollection(name) {
      mapFor(name)
    },
    async runTransaction(callback) {
      return callback({ collection })
    },
    values(name) {
      return [...mapFor(name).values()]
    }
  }
}

const row = (segmentDuration = '0:01:00.000') => ({
  carNumber: '7',
  segmentDuration,
  startTime: '08:00',
  endTime: '09:00'
})

function saveEvent(api, eventId, openid, expectedRevision = 0, segmentDuration = '0:01:00.000') {
  return api.saveWorkRecords({
    eventId,
    stage: 'SS1',
    expectedRevision,
    rows: [row(segmentDuration)]
  }, openid)
}

function uploadEvent(api, eventId, openid, expectedRevision = 0, segmentDuration = '0:01:00.000') {
  return api.uploadAllWorkRecords({
    eventId,
    records: [{ stage: 'SS1', expectedRevision, rows: [row(segmentDuration)] }]
  }, openid)
}

test('ordinary and unlogged users are denied get, save, and upload work records', async () => {
  const loaded = loadAccount()
  const db = makeDatabase({
    users: [{ _id: 'ordinary-user', openid: 'ordinary', phoneNumber: '13800000001', countryCode: '86' }]
  })
  loaded.setDatabase(db)

  const attempts = [
    ['get', () => loaded.api.getWorkRecords({ eventId: 'event-auth', stage: 'SS1' }, 'ordinary')],
    ['save', () => saveEvent(loaded.api, 'event-auth', 'ordinary')],
    ['upload', () => uploadEvent(loaded.api, 'event-auth', 'ordinary')],
    ['get-unlogged', () => loaded.api.getWorkRecords({ eventId: 'event-auth', stage: 'SS1' }, undefined)],
    ['save-unlogged', () => saveEvent(loaded.api, 'event-auth', undefined)],
    ['upload-unlogged', () => uploadEvent(loaded.api, 'event-auth', undefined)]
  ]
  for (const [name, attempt] of attempts) {
    await assert.rejects(attempt, /工作人员账户|工作权限/, name)
  }
  assert.equal(db.values('work_records').length, 0)
})

test('collection readiness checks share in-flight and successful promises, then retry after failure', async () => {
  const loaded = loadAccount()
  const db = makeDatabase()
  let checks = 0
  let failOnce = true
  const wrapped = {
    ...db,
    collection(name) {
      const collection = db.collection(name)
      return {
        ...collection,
        limit(value) {
          const query = collection.limit(value)
          return {
            ...query,
            async get() {
              if (name === 'work_records') {
                checks++
                if (failOnce) { failOnce = false; throw new Error('temporary network failure') }
              }
              return query.get()
            }
          }
        }
      }
    }
  }
  loaded.setDatabase(wrapped)
  await assert.rejects(loaded.api.ensureCollection('work_records'), /temporary network failure/)
  await Promise.all([
    loaded.api.ensureCollection('work_records'),
    loaded.api.ensureCollection('work_records')
  ])
  await loaded.api.ensureCollection('work_records')
  assert.equal(checks, 2, 'failed readiness check retries, then concurrent and later calls reuse success')
})

test('admin and staff role lookups start concurrently without changing resolved role', async () => {
  const loaded = loadAccount()
  const db = makeDatabase()
  const started = []
  const releases = new Map()
  const wrapped = {
    ...db,
    collection(name) {
      const collection = db.collection(name)
      return {
        ...collection,
        where(query) {
          const chain = collection.where(query)
          return {
            ...chain,
            limit(value) {
              const limited = chain.limit(value)
              return {
                ...limited,
                get() {
                  if (!['admin_users', 'staff_users'].includes(name)) return limited.get()
                  started.push(name)
                  return new Promise((resolve, reject) => releases.set(name, () => limited.get().then(resolve, reject)))
                }
              }
            }
          }
        }
      }
    }
  }
  loaded.setDatabase(wrapped)
  const rolePromise = loaded.api.resolveRole({ phoneNumber: '13800000001', countryCode: '86' })
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(started.sort(), ['admin_users', 'staff_users'])
  releases.get('admin_users')()
  releases.get('staff_users')()
  const role = await rolePromise
  assert.equal(role.role, 'user')
  assert.equal(role.isStaff, false)
})

test('event views count unique visitors per event and create the collection on demand', async () => {
  const loaded = loadAccount()
  const db = makeDatabase()
  loaded.setDatabase(db)

  assert.equal(await loaded.api.recordEventView('event-view-a', 'openid-1'), 1)
  assert.equal(await loaded.api.recordEventView('event-view-a', 'openid-1'), 1)
  assert.equal(await loaded.api.recordEventView('event-view-a', 'openid-2'), 2)
  assert.equal(await loaded.api.recordEventView('event-view-b', 'openid-1'), 1)
  assert.equal(db.values('event_views').length, 3)

  const stats = await loaded.api.eventStats('event-view-a', 'openid-1')
  assert.equal(stats.stats.viewCount, 2)
})

test('staff must have the requested stage and receives its entry permissions', async () => {
  const loaded = loadAccount()
  const db = makeDatabase({
    users: [{ _id: 'staff-user', openid: 'staff', phoneNumber: '13800000002', countryCode: '86' }],
    staff: [{
      _id: 'staff-permission',
      phoneNumber: '13800000002',
      countryCode: '86',
      enabled: true,
      stagePermissions: ['SS1'],
      entryPermissions: { startTime: false, endTime: true, penalty: false }
    }]
  })
  loaded.setDatabase(db)

  const wrongStageAttempts = [
    () => loaded.api.getWorkRecords({ eventId: 'event-stage', stage: 'SS2' }, 'staff'),
    () => loaded.api.saveWorkRecords({ eventId: 'event-stage', stage: 'SS2', expectedRevision: 0, rows: [row()] }, 'staff'),
    () => loaded.api.uploadAllWorkRecords({ eventId: 'event-stage', records: [{ stage: 'SS2', expectedRevision: 0, rows: [row()] }] }, 'staff')
  ]
  for (const attempt of wrongStageAttempts) await assert.rejects(attempt, /赛段权限|SS2/)
  assert.equal(db.values('work_records').length, 0)

  const initial = await loaded.api.getWorkRecords({ eventId: 'event-stage', stage: 'SS1' }, 'staff')
  assert.deepEqual(JSON.parse(JSON.stringify(initial.entryPermissions)), { startTime: false, endTime: true, penalty: false })
  assert.equal(initial.revision, 0)

  const saved = await saveEvent(loaded.api, 'event-stage', 'staff')
  assert.equal(saved.saved, true)
  assert.deepEqual(JSON.parse(JSON.stringify(saved.entryPermissions)), { startTime: false, endTime: true, penalty: false })

  const uploaded = await uploadEvent(loaded.api, 'event-stage', 'staff', 1, '0:01:01.000')
  assert.equal(uploaded.uploaded, true)
  assert.equal(uploaded.stageCount, 1)
})

test('admin can write the same car in two events without cross-event data leakage', async () => {
  const loaded = loadAccount()
  const db = makeDatabase({
    users: [{ _id: 'admin-user', openid: 'admin', phoneNumber: '13900000001', countryCode: '86' }],
    admins: [{ _id: 'admin-permission', phoneNumber: '13900000001', countryCode: '86', enabled: true }]
  })
  loaded.setDatabase(db)

  const first = await saveEvent(loaded.api, 'event-one', 'admin', 0, '0:01:00.000')
  const second = await saveEvent(loaded.api, 'event-two', 'admin', 0, '0:02:00.000')
  assert.equal(first.revision, 1)
  assert.equal(second.revision, 1)

  const eventOne = await loaded.api.getWorkRecords({ eventId: 'event-one', stage: 'SS1' }, 'admin')
  const eventTwo = await loaded.api.getWorkRecords({ eventId: 'event-two', stage: 'SS1' }, 'admin')
  assert.equal(eventOne.rows.length, 1)
  assert.equal(eventTwo.rows.length, 1)
  assert.equal(eventOne.rows[0].carNumber, '7')
  assert.equal(eventTwo.rows[0].carNumber, '7')
  assert.equal(eventOne.rows[0].segmentDuration, '0:01:00.000')
  assert.equal(eventTwo.rows[0].segmentDuration, '0:02:00.000')
  assert.deepEqual(JSON.parse(JSON.stringify(eventOne.entryPermissions)), { startTime: true, endTime: true, penalty: true })
  assert.equal(db.values('work_records').length, 2)
})

test('disabled staff entry fields survive single and batch saves and cannot be bypassed by derived durations', async () => {
  const loaded = loadAccount()
  const db = makeDatabase({
    users: [
      { _id: 'admin-user', openid: 'admin', phoneNumber: '13900000001', countryCode: '86' },
      { _id: 'staff-user', openid: 'staff', phoneNumber: '13800000002', countryCode: '86' }
    ],
    admins: [{ _id: 'admin-permission', phoneNumber: '13900000001', countryCode: '86', enabled: true }],
    staff: [{ _id: 'staff-permission', phoneNumber: '13800000002', countryCode: '86', enabled: true, stagePermissions: ['SS1'], entryPermissions: { startTime: false, endTime: false, penalty: false } }]
  })
  loaded.setDatabase(db)
  const eventId = 'entry-permissions'
  const original = {
    carNumber: '7', startTime: '08:00:00.000', endTime: '08:01:00.000',
    penaltyTotal: '20', penaltyInputs: [{ id: 'p1', value: '20' }],
    segmentDuration: '0:01:00.000', totalDuration: '0:01:20.000'
  }
  await loaded.api.saveWorkRecords({ eventId, stage: 'SS1', expectedRevision: 0, rows: [original] }, 'admin')
  const attempt = {
    ...original, startTime: '09:00:00.000', start: '09:00:00.000', endTime: '09:00:01.000', finish: '09:00:01.000',
    penaltyTotal: '999', penalty: '999', penaltyInputs: [{ id: 'injected', value: '999' }],
    durationManual: true, segmentDuration: '0:00:01.000', totalDuration: '0:00:01.000', duration: '0:00:01.000'
  }
  const payloadRows = [attempt, { ...attempt, carNumber: '8' }]
  const verify = async () => {
    const saved = await loaded.api.getWorkRecords({ eventId, stage: 'SS1' }, 'staff')
    const oldCar = saved.rows.find(item => item.carNumber === '7')
    for (const key of ['startTime', 'endTime', 'penaltyTotal', 'segmentDuration', 'totalDuration']) assert.equal(oldCar[key], original[key], key)
    assert.deepEqual(JSON.parse(JSON.stringify(oldCar.penaltyInputs)), original.penaltyInputs)
    assert.equal(oldCar.start, original.startTime)
    assert.equal(oldCar.finish, original.endTime)
    assert.equal(oldCar.penalty, original.penaltyTotal)
    assert.equal(oldCar.duration, original.totalDuration)
    assert.equal(oldCar.durationManual, false)
    const newCar = saved.rows.find(item => item.carNumber === '8')
    for (const key of ['startTime', 'start', 'endTime', 'finish', 'penaltyTotal', 'penalty', 'segmentDuration', 'totalDuration', 'duration']) assert.equal(newCar[key], '', key)
    assert.equal(newCar.penaltyInputs.length, 0)
    assert.equal(newCar.durationManual, false)
  }
  await loaded.api.saveWorkRecords({ eventId, stage: 'SS1', expectedRevision: 1, rows: payloadRows }, 'staff')
  await verify()
  await loaded.api.uploadAllWorkRecords({ eventId, records: [{ stage: 'SS1', expectedRevision: 2, rows: payloadRows }] }, 'staff')
  await verify()

  await loaded.api.saveWorkRecords({ eventId, stage: 'SS1', expectedRevision: 3, rows: [attempt] }, 'admin')
  const adminSaved = (await loaded.api.getWorkRecords({ eventId, stage: 'SS1' }, 'admin')).rows[0]
  for (const key of ['startTime', 'endTime', 'penaltyTotal', 'segmentDuration', 'totalDuration', 'durationManual']) assert.equal(adminSaved[key], attempt[key], `admin ${key}`)
  assert.deepEqual(JSON.parse(JSON.stringify(adminSaved.penaltyInputs)), attempt.penaltyInputs)
})

test('staff can change allowed finish time while protected start/penalty determine the derived result', async () => {
  const loaded = loadAccount()
  const db = makeDatabase({
    users: [
      { _id: 'admin-user', openid: 'admin', phoneNumber: '13729912574', countryCode: '86' },
      { _id: 'staff-user', openid: 'staff', phoneNumber: '13800000002', countryCode: '86' }
    ],
    staff: [{ _id: 'staff-permission', phoneNumber: '13800000002', countryCode: '86', enabled: true, stagePermissions: ['SS20'], entryPermissions: { startTime: false, endTime: true, penalty: false } }]
  })
  loaded.setDatabase(db)
  const eventId = 'partial-entry-permissions'
  const original = { carNumber: '9', startTime: '08:00:00.000', endTime: '08:01:00.000', penaltyTotal: '20', penaltyInputs: [{ id: 'p1', value: '20' }], segmentDuration: '0:01:00.000', totalDuration: '0:01:20.000' }
  await loaded.api.saveWorkRecords({ eventId, stage: 'SS20', expectedRevision: 0, rows: [original] }, 'admin')
  await loaded.api.saveWorkRecords({ eventId, stage: 'SS20', expectedRevision: 1, rows: [{ ...original, startTime: '07:00:00.000', endTime: '08:02:00.000', penaltyTotal: '999', durationManual: true, segmentDuration: '0:00:01.000', totalDuration: '0:00:01.000' }] }, 'staff')
  const result = (await loaded.api.getWorkRecords({ eventId, stage: 'SS20' }, 'staff')).rows[0]
  assert.equal(result.startTime, original.startTime)
  assert.equal(result.endTime, '08:02:00.000')
  assert.equal(result.penaltyTotal, '20')
  assert.equal(result.segmentDuration, '0:02:00.000')
  assert.equal(result.totalDuration, '0:02:20.000')
  assert.equal(result.durationManual, false)
})

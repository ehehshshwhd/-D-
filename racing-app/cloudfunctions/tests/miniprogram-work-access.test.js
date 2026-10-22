const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const appRoot = path.resolve(__dirname, '../..')
const stagesModule = require(path.join(appRoot, 'utils/stages'))
const tick = () => new Promise(resolve => setImmediate(resolve))

function loadPage(relativePath, options = {}) {
  const calls = { storage: [], cloud: [], navigate: [], modals: [], eventReads: 0 }
  const state = { user: options.user || null, roleError: null, events: options.events || [] }
  const storage = new Map()
  const wx = {
    showToast() {}, showModal(value) { calls.modals.push(value) }, pageScrollTo() {},
    navigateTo(value) { calls.navigate.push(value.url) },
    getStorageInfoSync() { calls.storage.push('list'); return { keys: [...storage.keys()] } },
    getStorageSync(key) { calls.storage.push(['get', key]); return storage.get(key) },
    setStorageSync(key, value) { calls.storage.push(['set', key]); storage.set(key, value) },
    removeStorageSync(key) { calls.storage.push(['remove', key]); storage.delete(key) },
    cloud: { callFunction: async request => {
      calls.cloud.push(request)
      if (state.cloudFailures && state.cloudFailures.length) throw state.cloudFailures.shift()
      const configured = state.responses && state.responses[request.data.action]
      const result = configured || state.response || { ok: true, eventId: request.data.eventId, stage: request.data.stage, rows: [], count: 0, revision: 0 }
      return { result: typeof result === 'function' ? result(request) : result }
    } }
  }
  const auth = {
    init() {},
    getUser: () => state.user,
    refreshRole: () => state.roleError ? Promise.reject(state.roleError) : Promise.resolve(state.user)
  }
  let page
  vm.runInNewContext(fs.readFileSync(path.join(appRoot, relativePath), 'utf8'), {
    Page(value) { page = value }, wx, console, setTimeout, clearTimeout,
    require(name) {
      if (name.endsWith('/auth')) return auth
      if (name.endsWith('/cloud-container')) return { call: async () => { calls.eventReads++; return { data: { ok: true, events: state.events } } } }
      if (name.endsWith('/stages')) return stagesModule
      if (name.endsWith('/cloud')) return { accountFunction: 'account' }
      return require(path.resolve(path.dirname(path.join(appRoot, relativePath)), name))
    }
  }, { filename: relativePath })
  page.data = JSON.parse(JSON.stringify(page.data))
  page.setData = (value, callback) => { Object.assign(page.data, value); if (callback) callback() }
  return { page, state, calls, storage }
}

function liveWorkPage(overrides = {}) {
  const harness = loadPage('pages/work/work.js', overrides)
  harness.page.setData({ eventId: 'event-one', allowed: true, eventScopeReady: true, stages: ['SS1', 'SS20'], selectedStage: 'SS20' })
  return harness
}

test('missing or invalid event ID never touches default/local scores or the cloud', async () => {
  for (const eventId of [undefined, '', '../other', '赛事', 'a'.repeat(81)]) {
    const { page, calls } = loadPage('pages/work/work.js')
    page.onLoad({ eventId })
    page.onShow()
    page.loadCarRows('SS1')
    assert.equal(page.saveRows([], 'SS1'), false)
    await assert.rejects(page.callWorkCloud('getWorkRecords', { stage: 'SS1' }), /赛事标识/)
    assert.equal(page.data.allowed, false)
    assert.equal(calls.storage.length, 0)
    assert.equal(calls.cloud.length, 0)
    assert.equal(calls.eventReads, 0)
  }
})

test('SS20 local cache keys preserve event IDs without character-replacement collisions', () => {
  const { page } = liveWorkPage()
  page.data.eventId = 'race-one'
  const first = page.storageKey('SS20')
  page.data.eventId = 'race_one'
  const second = page.storageKey('SS20')
  assert.notEqual(first, second)
  assert.equal(first, 'racing_shared_ss20_race-one')
  page.data.eventId = 'default'
  assert.equal(page.storageKey('SS20'), 'racing_shared_ss20_default')
  page.data.eventId = ''
  assert.throws(() => page.storageKey('SS20'), /赛事标识/)
})

test('cloud requests stay in their event and validate returned event/stage ownership', async () => {
  const { page, state, calls } = liveWorkPage()
  await page.callWorkCloud('getWorkRecords', { stage: 'SS20' })
  assert.equal(calls.cloud[0].data.eventId, 'event-one')
  assert.equal(calls.cloud[0].data.stage, 'SS20')
  await assert.rejects(page.callWorkCloud('saveWorkRecords', { eventId: 'event-two', stage: 'SS20' }), /赛事标识不一致/)
  state.response = { ok: true, eventId: 'event-two', stage: 'SS20' }
  await assert.rejects(page.callWorkCloud('getWorkRecords', { stage: 'SS20' }), /响应赛事标识不一致/)
  state.response = { ok: true, eventId: 'event-one', stage: 'SS1' }
  await assert.rejects(page.callWorkCloud('getWorkRecords', { stage: 'SS20' }), /响应赛段不一致/)
  page.data.allowed = false
  const previousCount = calls.cloud.length
  await assert.rejects(page.callWorkCloud('getWorkRecords', { stage: 'SS20' }), /工作权限/)
  assert.equal(calls.cloud.length, previousCount)
})

test('read-only work record requests retry transient network failures at most twice', async () => {
  const { page, state, calls } = liveWorkPage()
  state.cloudFailures = [new Error('request:fail timeout'), new Error('socket network error')]
  const result = await page.callWorkCloud('getWorkRecords', { stage: 'SS20' })
  assert.equal(result.ok, true)
  assert.equal(calls.cloud.length, 3)

  calls.cloud.length = 0
  state.cloudFailures = [new Error('request:fail timeout')]
  await assert.rejects(page.callWorkCloud('saveWorkRecords', { stage: 'SS20' }), /timeout/)
  assert.equal(calls.cloud.length, 1)
})

test('read-only work request does not retry business or authorization errors', async () => {
  const { page, state, calls } = liveWorkPage()
  state.response = { ok: false, code: 'NO_PERMISSION', message: '当前账户没有该赛段权限' }
  state.cloudFailures = []
  await assert.rejects(page.callWorkCloud('getWorkRecords', { stage: 'SS20' }), /没有该赛段权限/)
  assert.equal(calls.cloud.length, 1)
})

test('malformed old local cache is quarantined so a valid cloud row remains visible', async () => {
  const { page, state, storage } = liveWorkPage()
  const key = page.storageKey('SS20')
  storage.set(key, { rows: [{ carNumber: '1' }] })
  state.response = {
    ok: true,
    eventId: 'event-one',
    stage: 'SS20',
    rows: [{ id: 'row-1', carNumber: '1', startTime: '14:25:34.12', endTime: '14:40:25.13', penaltyInputs: [{ id: 'p1', value: '' }] }],
    count: 1,
    revision: 1
  }
  page.syncCloudRows('SS20')
  await tick()
  await tick()
  assert.equal(page.data.carRows.length, 1)
  assert.equal(page.data.visibleCarRows.length, 1)
  assert.equal(page.data.visibleCarRows[0].carNumber, '1')
  assert.equal(storage.has(key), false)
  assert.equal([...storage.keys()].some(item => item.startsWith(`${key}_corrupt_`)), true)
})

test('batch upload quarantines malformed clean SS4 cache and preserves selected SS2 editor rows', async () => {
  const { page, state, calls, storage } = liveWorkPage({ events: [{ id: 'event-one', stageNames: ['SS2', 'SS4'] }] })
  page.setData({ stages: ['SS2', 'SS4'], selectedStage: 'SS2' })
  const row = { id: 'row-1', carNumber: '1', startTime: '14:25:34.12', endTime: '14:40:25.13', penaltyInputs: [{ id: 'p1', value: '' }] }
  page.setData({ carRows: [row] })
  storage.set(page.storageKey('SS4'), { legacyRows: [{ carNumber: 'old' }] })
  state.responses = {
    getWorkRecords: request => ({ ok: true, eventId: 'event-one', stage: request.data.stage, rows: [], count: 0, revision: 0 }),
    uploadAllWorkRecords: request => ({ ok: true, eventId: 'event-one', stage: 'SS2', uploaded: true, stageCount: 1, rowCount: 1, records: [{ stage: 'SS2', revision: 1 }] })
  }

  page.uploadAllRecords()
  const confirmation = calls.modals.find(item => item.title === '确认上传')
  assert.ok(confirmation)
  confirmation.success({ confirm: true })
  await tick()
  await tick()
  await tick()

  const upload = calls.cloud.find(item => item.data.action === 'uploadAllWorkRecords')
  assert.ok(upload)
  assert.deepEqual(Array.from(upload.data.records, item => item.stage), ['SS2'])
  assert.equal(upload.data.records[0].rows[0].carNumber, '1')
  assert.equal(storage.has(page.storageKey('SS4')), false)
  assert.equal([...storage.keys()].some(key => key.startsWith(`${page.storageKey('SS4')}_corrupt_`)), true)
  assert.equal(page.data.uploading, false)
})

test('batch upload skips malformed penalty data in a clean non-selected stage', async () => {
  const { page, state, calls, storage } = liveWorkPage({ events: [{ id: 'event-one', stageNames: ['SS1', 'SS2'] }] })
  page.setData({ stages: ['SS1', 'SS2'], selectedStage: 'SS2' })
  const selectedRow = { id: 'row-2', carNumber: '2', startTime: '14:25:34.12', endTime: '14:40:25.13', penaltyInputs: [{ id: 'p2', value: '' }] }
  page.setData({ carRows: [selectedRow] })
  storage.set(page.storageKey('SS1'), [{ id: 'row-1', carNumber: '1', startTime: '14:00:00.00', endTime: '14:01:00.00', penaltyInputs: { invalid: true } }])
  state.responses = {
    getWorkRecords: request => ({ ok: true, eventId: 'event-one', stage: request.data.stage, rows: [], count: 0, revision: 0 }),
    uploadAllWorkRecords: request => ({ ok: true, eventId: 'event-one', stage: 'SS2', uploaded: true, stageCount: 1, rowCount: 1, records: [{ stage: 'SS2', revision: 1 }] })
  }

  page.uploadAllRecords()
  const confirmation = calls.modals.find(item => item.title === '确认上传')
  assert.ok(confirmation)
  confirmation.success({ confirm: true })
  await tick()
  await tick()
  await tick()

  const upload = calls.cloud.find(item => item.data.action === 'uploadAllWorkRecords')
  assert.ok(upload)
  assert.deepEqual(Array.from(upload.data.records, item => item.stage), ['SS2'])
  assert.equal(upload.data.records[0].rows[0].carNumber, '2')
  assert.equal(storage.has(page.storageKey('SS1')), false)
  assert.equal([...storage.keys()].some(key => key.startsWith(`${page.storageKey('SS1')}_corrupt_`)), true)
  assert.equal(page.data.uploading, false)
})

test('batch upload still stops when malformed cache has dirty or matching pending work', async () => {
  for (const kind of ['dirty', 'pending']) {
    const { page, calls, storage } = liveWorkPage()
    const key = page.storageKey('SS20')
    storage.set(key, { legacyRows: [] })
    if (kind === 'dirty') storage.set(page.dirtyStorageKey('SS20'), true)
    else storage.set(page.pendingStorageKey('SS20'), { eventId: 'event-one', rows: [{ carNumber: '1' }], expectedRevision: 0 })
    page.uploadAllRecords()
    const confirmation = calls.modals.find(item => item.title === '确认上传')
    confirmation.success({ confirm: true })
    await tick()
    assert.equal(calls.cloud.length, 0)
    assert.equal(storage.has(key), true)
    assert.equal(page.data.uploading, false)
    assert.match(calls.modals.at(-1).content, /本地成绩读取失败/)
  }
})

test('cloud calls reject unassigned stages and batches containing unassigned stages', async () => {
  const { page, calls } = liveWorkPage()
  await assert.rejects(page.callWorkCloud('getWorkRecords', { stage: 'SS19' }), /工作权限/)
  await assert.rejects(page.callWorkCloud('uploadAllWorkRecords', { records: [{ stage: 'SS19', rows: [] }] }), /工作权限/)
  assert.equal(calls.cloud.length, 0)
})

test('work page validates published event and retains its configured SS20 scope', async () => {
  const { page, state } = liveWorkPage({ events: [{ id: 'event-one', stageNames: ['SS1', 'SS20'], workBackendEnabled: true }] })
  assert.deepEqual(Array.from((await page.loadEventScope('event-one')).stages), ['SS1', 'SS20'])
  await assert.rejects(page.loadEventScope('missing'), /尚未发布/)
  state.events[0].workBackendEnabled = false
  await assert.rejects(page.loadEventScope('event-one'), /未开放/)
  state.events = [{ id: 'event-one', stageNames: ['SS21'] }]
  await assert.rejects(page.loadEventScope('event-one'), /配置无效/)
  state.events = [{ id: 'event-one', stageNames: ['SS20'] }, { id: 'event-one', stageNames: ['SS1'] }]
  await assert.rejects(page.loadEventScope('event-one'), /配置重复/)
})

test('staff work stage scope is the intersection of configured stages and live permissions', async () => {
  const { page } = loadPage('pages/work/work.js', {
    user: { isStaff: true, stagePermissions: ['SS20'] },
    events: [{ id: 'event-one', stageNames: ['SS1', 'SS20'] }]
  })
  page.onLoad({ eventId: 'event-one' })
  page.onShow()
  await tick()
  assert.equal(page.data.allowed, true)
  assert.equal(page.data.selectedStage, 'SS20')
  assert.deepEqual(Array.from(page.data.stages), ['SS20'])
})

test('ordinary and unassigned staff users cannot enter/read work data by direct navigation', async () => {
  for (const user of [null, { isStaff: false, isAdmin: false }, { isStaff: true, stagePermissions: ['SS1'] }]) {
    const { page, calls } = loadPage('pages/work/work.js', { user, events: [{ id: 'event-one', stageNames: ['SS20'] }] })
    page.onLoad({ eventId: 'event-one' })
    page.onShow()
    await tick()
    assert.equal(page.data.allowed, false)
    assert.equal(calls.storage.length, 0)
    assert.equal(calls.cloud.length, 0)
  }
})

function detailPage(user) {
  const harness = loadPage('subpackages/events/detail/detail.js', { user })
  harness.page.setData({ id: 'event-new', eventCloudReady: true, eventConfigReady: true, event: { id: 'event-new', isDynamic: true, workBackendEnabled: true, stageNames: ['SS20'] } })
  return harness
}

test('published event can hide every signup count while retaining fees, units and notes', async () => {
  const { page, state } = detailPage(null)
  const event = {
    id: 'event-new', title: '测试赛事', hideSignupCount: true,
    signupOptions: [
      { name: '四驱组', fee: '3000', unit: '辆', registeredCount: 12, note: '含保险' },
      { name: '女子组', fee: '600', unit: '人', registeredCount: 3 },
      { name: '公开组', fee: '1000', unit: '车', registeredCount: 5, note: '已报5辆' }
    ]
  }
  state.events = [event]
  for (const hidden of [true, false, undefined]) {
    event.hideSignupCount = hidden
    page.loadPublishedEvent(event.id)
    await tick()
    await tick()
    assert.equal(page.data.eventCloudReady, true)
    const text = Array.from(page.data.event.signupOptions, item => item.displayText)
    assert.equal(text.some(value => value.includes('已报')), hidden !== true)
    assert.ok(text[0].includes('四驱组 ¥ 3000/辆'))
    assert.ok(text[0].includes('（含保险）'))
    assert.ok(text[1].includes('女子组 ¥ 600/人'))
    if (hidden !== true) {
      assert.ok(text[0].includes('（已报12辆）'))
      assert.ok(text[1].includes('（已报3人）'))
    }
  }
})

test('new-event entry displays only for authorized staff/admin, including SS20', async () => {
  const cases = [
    [null, false], [{ role: 'user' }, false],
    [{ role: 'staff', stagePermissions: ['SS1'] }, false],
    [{ role: 'staff', stagePermissions: ['SS20'] }, true],
    [{ role: 'admin' }, true], [{ role: 'superadmin' }, true]
  ]
  for (const [user, expected] of cases) {
    const { page, calls } = detailPage(user)
    page.loadWorkAccess()
    await tick()
    assert.equal(page.data.canAccessWork, expected)
    page.openWorkBackend()
    await tick()
    assert.equal(calls.navigate.length, expected ? 1 : 0)
    if (expected) assert.equal(calls.navigate[0], '/pages/work/work?eventId=event-new')
  }
})

test('entry closes on missing event, disabled work backend, and permission refresh failure', async () => {
  for (const failure of ['missing', 'disabled', 'role']) {
    const { page, state, calls } = detailPage({ role: 'admin' })
    page.data.canAccessWork = true
    if (failure === 'missing') page.data.eventCloudReady = false
    if (failure === 'disabled') page.data.event.workBackendEnabled = false
    if (failure === 'role') state.roleError = new Error('connection failed')
    page.loadWorkAccess()
    await tick()
    assert.equal(page.data.canAccessWork, false)
    page.openWorkBackend()
    await tick()
    assert.equal(calls.navigate.length, 0)
  }
})

test('permission editor offers SS1–SS20 and preserves explicitly saved stage selection', () => {
  const { page } = loadPage('pages/permissions/permissions.js')
  assert.equal(page.data.stageOptions.length, 20)
  assert.equal(page.data.stageOptions[19], 'SS20')
  page.data.staff = [{ id: 'staff-one', stagePermissions: ['SS1', 'SS9'] }]
  page.editPermission({ currentTarget: { dataset: { id: 'staff-one' } } })
  assert.deepEqual(Array.from(page.data.stagePermissions), ['SS1', 'SS9'])
  assert.equal(page.data.stageChoices.find(item => item.name === 'SS20').checked, false)
})

test('authentication defaults cover SS20 without broadening saved staff permissions', () => {
  const source = fs.readFileSync(path.join(appRoot, 'utils/auth.js'), 'utf8')
  for (const stagePermissions of [undefined, ['SS1', 'SS9'], ['SS20'], []]) {
    const storedUser = { id: 'staff-one', role: 'staff', stagePermissions }
    const module = { exports: {} }
    vm.runInNewContext(source, {
      module, console, setTimeout, clearTimeout,
      wx: { getStorageSync: () => storedUser, setStorageSync() {} },
      require: name => name === './stages' ? stagesModule : {}
    })
    const actual = Array.from(module.exports.getUser().stagePermissions)
    assert.deepEqual(actual, stagePermissions === undefined ? stagesModule.ALL_STAGES : stagePermissions)
  }
})

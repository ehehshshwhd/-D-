'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { test } = require('node:test')
const cloudStore = require('../cloud-store')

const sourcePath = path.resolve(__dirname, '../../full-system/index.html')
const source = fs.readFileSync(sourcePath, 'utf8')
const start = source.indexOf('function editorEventToCloudEvent(')
const end = source.indexOf('\nasync function loadRemoteEvents(', start)
assert.ok(start >= 0 && end > start, 'production event mapper should exist')
const mapper = source.slice(start, end)

test('long event details fit the CloudBase document limit without losing their HTML', () => {
  const context = vm.createContext({})
  vm.runInContext(mapper, context)
  const detailPageHtml = `<p>${'赛'.repeat(200_000)}</p>`
  const event = {
    id: 'event-payload-test',
    title: '详情保存测试',
    type: '拉力赛',
    status: '报名中',
    content: detailPageHtml,
    form: { city: '资兴市', address: '', contact: '', phone: '', wechat: '' },
    dates: { start: '2026-10-31', end: '2026-11-02', deadline: '2026-10-22' },
    img: 'https://example.test/cover.jpg',
    groups: ['公开组'],
    signupOptions: [{ name: '公开组', fee: '1', unit: '车' }]
  }
  const fields = { ...event.form, title: event.title, type: event.type, level: '', hideSignupCount: false, registrationEnabled: true }
  const payload = vm.runInContext(
    `editorEventToCloudEvent(event, fields, dates, detailPageHtml)`,
    vm.createContext({ editorEventToCloudEvent: context.editorEventToCloudEvent, event, fields, dates: event.dates, detailPageHtml })
  )

  assert.ok(Buffer.byteLength(JSON.stringify(payload)) < 700 * 1024)
  assert.equal(payload.detailPageHtml, detailPageHtml)
  assert.equal(Object.hasOwn(payload, 'content'), false)
  assert.equal(Object.hasOwn(payload, 'form'), false)
  assert.equal(Object.hasOwn(payload, 'dates'), false)
  assert.equal(Object.hasOwn(payload, 'img'), false)
  assert.doesNotThrow(() => cloudStore.validateEventInput(payload))
})

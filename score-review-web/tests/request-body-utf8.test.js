'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { Readable } = require('node:stream')
const { test } = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(path.resolve(__dirname, '..', 'server.js'), 'utf8')
const parseBody = vm.runInNewContext(`${source.slice(source.indexOf('function body(req)'), source.indexOf('function key('))}; body`, { Buffer })

test('request parsing preserves Chinese and emoji split across network chunks', async () => {
  const detailPageHtml = '<p>赛事详情：资兴汽车拉力赛🏁</p>'
  const bytes = Buffer.from(JSON.stringify({ detailPageHtml }))
  const chunks = Array.from(bytes, (_, index) => bytes.subarray(index, index + 1))
  const parsed = await parseBody(Readable.from(chunks))
  assert.equal(parsed.detailPageHtml, detailPageHtml)
})

test('large event details survive UTF-8 splits without replacement characters', async () => {
  const detailPageHtml = `<p>${'赛段全长约11公里。'.repeat(20_000)}</p>`
  const bytes = Buffer.from(JSON.stringify({ detailPageHtml }))
  const chunks = []
  for (let offset = 0; offset < bytes.length; offset += 16_384) chunks.push(bytes.subarray(offset, offset + 16_384))
  const parsed = await parseBody(Readable.from(chunks))
  assert.ok(parsed.detailPageHtml === detailPageHtml, 'large details must round-trip without corrupting Chinese text')
})

test('request parsing still rejects malformed JSON', async () => {
  await assert.rejects(parseBody(Readable.from([Buffer.from('{invalid')])), /请求格式无效/)
})

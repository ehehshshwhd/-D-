'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { test } = require('node:test')

const source = fs.readFileSync(path.resolve(__dirname, '../../full-system/index.html'), 'utf8')

test('event cards do not wrap an empty event type in square brackets', () => {
  const start = source.indexOf('function EventCard(')
  const end = source.indexOf('\nfunction ', start + 1)
  assert.ok(start >= 0 && end > start, 'event card component should exist')
  const card = source.slice(start, end)
  assert.match(card, /\{ev\.type && <span[^>]*>\{ev\.type\} <\/span>\}\{ev\.title\}/)
  assert.doesNotMatch(card, /\[\{ev\.type\}\]/)
})

test('event display IDs increase in creation order, including newly published events', () => {
  const start = source.indexOf('function assignEventDisplayIds(')
  const end = source.indexOf('\nfunction ', start + 1)
  assert.ok(start >= 0 && end > start, 'event display ID mapper should exist')
  const context = vm.createContext({})
  vm.runInContext(source.slice(start, end), context)

  const newestFirst = [
    { id: 'event-3', createdAt: '2026-10-24T03:00:00.000Z' },
    { id: 'event-2', createdAt: '2026-10-23T03:00:00.000Z' },
    { id: 'event-1', createdAt: '2026-10-22T03:00:00.000Z' }
  ]
  const numbered = context.assignEventDisplayIds(newestFirst)
  assert.deepEqual(numbered.map(event => event.displayId), [3, 2, 1])

  const withNextEvent = context.assignEventDisplayIds([
    { id: 'event-4', createdAt: '2026-10-25T03:00:00.000Z' },
    ...numbered
  ])
  assert.equal(withNextEvent[0].displayId, 4)
})

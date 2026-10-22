'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const adapter = require('../../full-system/score-review-cloud.js')

test('calculates and formats stage time from start and finish clocks like the race system', () => {
  assert.equal(adapter.durationFromClocks('12:34:14.14', '12:37:12.41'), 178.27)
  assert.equal(adapter.formatDuration(adapter.durationFromClocks('13:41:15', '13:45:12')), '0:03:57.000')
  assert.equal(adapter.durationFromClocks('23:59:59.900', '00:00:01.100'), 1.2)
  assert.equal(adapter.stageDurationSeconds({ startAt: '12:34:14.14', finishAt: '12:37:12.41', time: 999 }), 178.27)
  assert.equal(adapter.stageDurationSeconds({ startAt: '12:34:14.14', finishAt: '12:37:12.41', time: 179, durationManual: true }), 179)
  assert.equal(adapter.stageDurationSeconds({ startAt: '', finishAt: '', time: 179 }), 179)
  assert.equal(adapter.formatDuration(adapter.stageDurationSeconds({ startAt: '12:34:14.14', finishAt: '12:37:12.41' })), '0:02:58.270')
})

test('cloud saves keep computed timing automatic unless an operator explicitly edits it', () => {
  const computed = adapter.toCloudRow({ number: '23', stage: 'SS1', startAt: '12:34:14.14', finishAt: '12:37:12.41', time: 999 })
  assert.equal(computed.segmentDuration, '0:02:58.270')
  assert.equal(computed.durationManual, false)

  const manual = adapter.toCloudRow({ number: '23', stage: 'SS1', startAt: '12:34:14.14', finishAt: '12:37:12.41', time: 179, durationManual: true })
  assert.equal(manual.segmentDuration, '0:02:59.000')
  assert.equal(manual.durationManual, true)
})

test('manual edits override the old cloud duration and survive a cloud round trip', () => {
  const row = adapter.fromCloudRow({ carNumber: '23', startTime: '12:34:14.14', endTime: '12:37:12.41', segmentDuration: '0:02:58.270', durationManual: true }, 'SS1')
  const edited = { ...row, time: 180.001 }
  assert.equal(adapter.stageDurationSeconds(edited), 180.001)
  const saved = adapter.toCloudRow(edited)
  assert.equal(saved.segmentDuration, '0:03:00.001')
  assert.equal(adapter.fromCloudRow(saved, 'SS1').time, 180.001)
})

test('missing timing stays empty and zero remains a valid duration', () => {
  assert.equal(adapter.stageDurationSeconds({ time: null }), null)
  assert.equal(adapter.formatDuration(null), '')
  assert.equal(adapter.formatDuration(''), '')
  assert.equal(adapter.stageDurationSeconds({ time: 0 }), 0)
  assert.equal(adapter.formatDuration(0), '0:00:00.000')
})

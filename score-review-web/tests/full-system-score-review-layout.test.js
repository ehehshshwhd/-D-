'use strict'

const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')

test('score review has one fullscreen control beside refresh data', () => {
  const html = fs.readFileSync(path.join(__dirname, '../../full-system/index.html'), 'utf8')
  const start = html.indexOf('function ScoreReview(')
  const end = html.indexOf('function DetailPage(', start)
  assert.notEqual(start, -1, 'score review component should exist')
  assert.notEqual(end, -1, 'score review component should end before detail page')
  const component = html.slice(start, end)
  assert.equal((component.match(/fullscreenButton\('review'\)/g) || []).length, 1)
  assert.match(component, /刷新数据<\/button>\{fullscreenButton\('review'\)\}/)
  assert.doesNotMatch(component, /成绩审核<\/h2><\/div>\{fullscreenButton\('review'\)\}/)
})

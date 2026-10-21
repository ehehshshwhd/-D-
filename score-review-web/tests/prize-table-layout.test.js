const test = require('node:test')
const assert = require('node:assert/strict')
const { inferPrizeGroupCount, inferPrizeTheme, isCompactStageTable, normalizeStageLabel, splitGroupedPrizeTable, groupedPrizeBlockToGroups } = require('../prize-table-layout')

test('assigns each event group its own prize-table color theme', () => {
  assert.deepEqual([
    inferPrizeTheme('场地越野赛（专业组）奖金设置 11.5万元'),
    inferPrizeTheme('场地越野赛（公开组）奖金设置 8.5万元'),
    inferPrizeTheme('场地越野赛（UTV组）奖金设置 8.5万元'),
    inferPrizeTheme('场地越野赛（新秀组）奖金设置 6.3万元'),
    inferPrizeTheme('场地越野赛（女子组）奖金设置 5.2万元'),
  ], ['orange', 'maroon', 'green', 'yellow', 'purple'])
})

test('uses one blue theme for the four-group tank matrix', () => {
  assert.equal(inferPrizeTheme('坦克汽车（定向集结赛）奖金设置 19.2万元'), 'blue')
})

test('recognizes four group headings as four rank/prize pairs, including spaced labels', () => {
  const headings = ['公开 A组', '公开 B组', '公开 C组', '公开 D组']

  assert.equal(inferPrizeGroupCount(headings, 8), 4)
  assert.equal(isCompactStageTable(headings, 8), false)
})

test('recognizes compact rank-and-prize rows under four group-only headers', () => {
  const headings = ['公开 A组', '公开 B组', '公开 C组', '公开 D组']

  assert.equal(inferPrizeGroupCount(headings, 4, false, true), 4)
})

test('preserves three-stage group headings rather than treating them as four-group tables', () => {
  const headings = ['排位赛奖金', '预赛奖金', '决赛奖金']

  assert.equal(inferPrizeGroupCount(headings, 6), 3)
  assert.equal(isCompactStageTable(headings, 6), false)
})

test('uses the reference labels for stage headers created by the article editor', () => {
  assert.deepEqual(['排位赛', '预赛', '决赛'].map(normalizeStageLabel), ['排位赛奖金', '预赛奖金', '决赛奖金'])
  assert.equal(normalizeStageLabel('排位赛奖金'), '排位赛奖金')
})

test('recognizes legacy compact stage rows only when they contain three cells', () => {
  const headings = ['排位赛奖金', '预赛奖金', '决赛奖金']

  assert.equal(isCompactStageTable(headings, 3), true)
  assert.equal(isCompactStageTable(headings, 6), false)
})

test('does not reinterpret ordinary spanning group headers', () => {
  const headings = ['公开A组', '公开B组', '公开C组', '公开D组']

  assert.equal(inferPrizeGroupCount(headings, 8, true), 4)
  assert.equal(isCompactStageTable(headings, 8), false)
})

test('splits a four-group table into four complete rank/prize tables with each subtotal retained', () => {
  const groups = splitGroupedPrizeTable(
    ['公开A组名次', '奖金', '公开B组名次', '奖金', '公开C组名次', '奖金', '公开D组名次', '奖金'],
    [
      ['第一名', '20000', '第一名', '20000', '第一名', '20000', '第一名', '20000'],
      ['第二名', '10000', '第二名', '10000', '第二名', '10000', '第二名', '10000'],
      ['小计：48000元', '小计：48000元', '小计：48000元', '小计：48000元'],
    ],
  )

  assert.deepEqual(groups.map(group => group.label), ['公开A组', '公开B组', '公开C组', '公开D组'])
  assert.deepEqual(groups.map(group => group.rows[0]), [
    ['第一名', '20000'], ['第一名', '20000'], ['第一名', '20000'], ['第一名', '20000'],
  ])
  assert.deepEqual(groups.map(group => group.rows.at(-1)), [
    ['小计：48000元', ''], ['小计：48000元', ''], ['小计：48000元', ''], ['小计：48000元', ''],
  ])
})

test('splits compact rank-and-prize cells when each legacy row has one cell per group', () => {
  const groups = splitGroupedPrizeTable(
    ['公开A组名次', '奖金', '公开B组名次', '奖金', '公开C组名次', '奖金', '公开D组名次', '奖金'],
    [['第一名：3000', '第一名：6000', '第一名：10000', '第一名：20000']],
  )

  assert.deepEqual(groups.map(group => group.rows[0]), [
    ['第一名', '3000'], ['第一名', '6000'], ['第一名', '10000'], ['第一名', '20000'],
  ])
})

test('expands four group-only headers before building the matrix source model', () => {
  const groups = groupedPrizeBlockToGroups({
    headers: ['公开A组', '公开B组', '公开C组', '公开D组'],
    rows: [['第一名：3000', '第一名：6000', '第一名：10000', '第一名：20000']],
  })

  assert.deepEqual(groups.map(group => [group.label, group.rows[0]]), [
    ['公开A组', ['第一名', '3000']], ['公开B组', ['第一名', '6000']],
    ['公开C组', ['第一名', '10000']], ['公开D组', ['第一名', '20000']],
  ])
})

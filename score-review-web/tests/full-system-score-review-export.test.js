'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { test } = require('node:test')

test('score exports keep car and penalty widths, set remaining columns to 12.12, and center SS1-SS20', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../full-system/score-review-export.js'), 'utf8')
  const page = fs.readFileSync(path.join(__dirname, '../../full-system/index.html'), 'utf8')
  assert.match(page, /stages=Array\.from\(\{length:20\}/)
  const context = { window: {} }
  vm.runInNewContext(source, context)
  const appended = []
  const XLSX = {
    utils: {
      aoa_to_sheet(rows) {
        const sheet = {}
        rows.forEach((row, r) => row.forEach((value, c) => { if (value !== '') sheet[this.encode_cell({ r, c })] = { v: value } }))
        return sheet
      },
      encode_cell({ r, c }) { return `${String.fromCharCode(65 + c)}${r + 1}` },
      book_append_sheet(workbook, worksheet, name) { appended.push({ name, worksheet }) }
    }
  }
  const stages = Array.from({ length: 20 }, (_, i) => `SS${i + 1}`)
  context.window.ScoreReviewExport.appendSheet(XLSX, {}, {
    name: 'SS20',
    rows: [['车号', '发车时间', '收车时间', '罚时', '赛段用时'], ['23', '15:14:12.122', '15:35:11.241', '5秒', '0:20:59.119']]
  })
  context.window.ScoreReviewExport.appendSheet(XLSX, {}, {
    name: '总成绩',
    rows: [['车号', '总成绩', ...stages], ['23', '1:20:00.000', ...stages.map(() => '0:04:00.000')]]
  })

  const stage = appended[0].worksheet
  assert.deepEqual(JSON.parse(JSON.stringify(stage['!cols'])), [{}, { wch: 12.12 }, { wch: 12.12 }, {}, { wch: 12.12 }])
  assert.equal(stage.A1.s.alignment.horizontal, 'center')
  assert.equal(stage.D2.s.alignment.horizontal, 'center')
  const total = appended[1].worksheet
  assert.equal(total['!cols'][0].wch, undefined)
  assert.equal(total['!cols'][21].wch, 12.12)
  assert.equal(total.V1.s.alignment.horizontal, 'center')
})

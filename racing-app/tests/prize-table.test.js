const test = require('node:test')
const assert = require('node:assert/strict')
const { convertGroupedPrizeTables, normalizePrizeTableColors, normalizePrizeTitleColors, prizeTableMobileLayout, prizeThemeForTitle, prizeThemePalette, repairPrizeTableColspans } = require('../utils/prize-table')

const professionalPrizeTable = `
<div class="mini-preview-prize-title" style="background-color:#c95b0c;color:#fff">场地越野赛（专业组）奖金设置 11.5万元</div>
<table><thead><tr>
  <th colspan="2" style="background-color:#dedede">排位赛奖金</th>
  <th colspan="2" style="background-color:#dedede">预赛奖金</th>
  <th colspan="2" style="background-color:#dedede">决赛奖金</th>
</tr></thead><tbody>
<tr><td>第一名</td><td>5000</td><td>第一名</td><td>10000</td><td>第一名</td><td>30000</td></tr>
<tr><td>第二名</td><td>3000</td><td>第二名</td><td>5000</td><td>第二名</td><td>20000</td></tr>
<tr><td>第三名</td><td>1000</td><td>第三名</td><td>4000</td><td>第三名</td><td>10000</td></tr>
<tr><td>--</td><td>--</td><td>第四名</td><td>3000</td><td>第四名</td><td>6000</td></tr>
<tr><td>--</td><td>--</td><td>第五名</td><td>2000</td><td>第五名</td><td>5000</td></tr>
<tr><td>--</td><td>--</td><td>第六名</td><td>1000</td><td>第六名</td><td>4000</td></tr>
<tr><td>--</td><td>--</td><td>--</td><td>--</td><td>第七名</td><td>3000</td></tr>
<tr><td>--</td><td>--</td><td>--</td><td>--</td><td>第八名</td><td>2000</td></tr>
<tr><td>--</td><td>--</td><td>--</td><td>--</td><td>第九名</td><td>1000</td></tr>
<tr class="mini-preview-prize-total-row"><td colspan="2">小计：9000元</td><td colspan="2">小计：25000</td><td colspan="2">小计：81000元</td></tr>
</tbody></table>`

test('renders three prize stages as one six-column table that fits a phone width', () => {
  const html = convertGroupedPrizeTables(repairPrizeTableColspans(professionalPrizeTable))

  assert.equal((html.match(/mini-preview-mobile-prize-three-stage-group/g) || []).length, 3)
  assert.equal((html.match(/mini-preview-mobile-prize-three-stage-row/g) || []).length, 10)
  assert.match(html, /排位赛奖金/)
  assert.match(html, /预赛奖金/)
  assert.match(html, /决赛奖金/)
  assert.match(html, /第一名/)
  assert.match(html, /5000/)
  assert.match(html, /小计：9000元/)
  assert.match(html, /小计：25000/)
  assert.match(html, /小计：81000元/)
  assert.doesNotMatch(html, />名次<\/div>|>奖金<\/div>|min-width:\s*\d{3,}px/i)
  assert.doesNotMatch(html, /<table\b/i)
})

test('assigns distinct reference colors to each named event group', () => {
  const themes = ['专业组', '公开组', 'UTV组', '新秀组', '女子组'].map(name => prizeThemeForTitle(`场地越野赛（${name}）奖金设置`))
  const titleColors = themes.map(theme => prizeThemePalette(theme).titleColor)

  assert.deepEqual(themes, ['orange', 'maroon', 'green', 'yellow', 'purple'])
  assert.equal(new Set(titleColors).size, 5)
})

test('replaces shared legacy defaults with group colors while retaining custom colors', () => {
  const titles = ['专业组', '公开组', 'UTV组', '新秀组', '女子组']
  const colors = titles.map(name => normalizePrizeTableColors({
    title: `场地越野赛（${name}）奖金设置`,
    headers: ['排位赛奖金', '奖金', '预赛奖金', '奖金', '决赛奖金', '奖金'],
    rows: [],
    titleColor: '#c95b0c', headerColor: '#d7d7d7', bodyColor: '#d7d7d7', totalColor: '#c95b0c', textColor: '#222222', titleTextColor: '#ffffff'
  }))

  assert.equal(new Set(colors.map(color => color.titleColor)).size, 5)
  assert.deepEqual(colors.map(color => color.prizeMobileLayout.type), Array(5).fill('stages'))
  assert.equal(normalizePrizeTableColors({ title: '场地越野赛（UTV组）奖金设置', titleColor: '#123456' }).titleColor, '#123456')
})

test('uses the named group color when converting its three-stage static table', () => {
  const source = '<table><caption>场地越野赛（UTV组）奖金设置</caption><thead><tr><th colspan="2">排位赛奖金</th><th colspan="2">预赛奖金</th><th colspan="2">决赛奖金</th></tr></thead><tbody><tr><td>第一名</td><td>3000</td><td>第一名</td><td>6000</td><td>第一名</td><td>20000</td></tr><tr class="mini-preview-prize-total-row"><td colspan="2">合计：6000元</td><td colspan="2">合计：21000元</td><td colspan="2">合计：58000元</td></tr></tbody></table>'
  const html = convertGroupedPrizeTables(source)

  assert.match(html, /background-color:#4f812f[^\"]*color:#fff/)
  assert.match(html, /background-color:#a8d18d/)
  assert.match(html, /background-color:#c7e2b8/)
})

test('infers the group palette from a title outside the table and alternates the reference row colors', () => {
  const source = '<div class="mini-preview-prize-title">场地越野赛（UTV组）奖金设置</div><table><thead><tr><th colspan="2">排位赛奖金</th><th colspan="2">预赛奖金</th><th colspan="2">决赛奖金</th></tr></thead><tbody><tr><td>第一名</td><td>3000</td><td>第一名</td><td>6000</td><td>第一名</td><td>20000</td></tr><tr><td>第二名</td><td>2000</td><td>第二名</td><td>5000</td><td>第二名</td><td>10000</td></tr></tbody></table>'
  const html = convertGroupedPrizeTables(source)

  assert.match(html, /background-color:#a8d18d/)
  assert.match(html, /background-color:#c7e2b8/)
  assert.match(html, /background-color:#b5d99f/)
})

test('adds alternating row colors to editable three-stage mobile layouts', () => {
  const block = normalizePrizeTableColors({
    title: '场地越野赛（新秀组）奖金设置',
    headers: ['排位赛奖金', '预赛奖金', '决赛奖金'],
    rows: [['第一名：3000', '第一名：6000', '第一名：10000'], ['第二名：2000', '第二名：5000', '第二名：8000']]
  })

  assert.equal(block.prizeMobileLayout.rows[0].groups[0].rowColor, '#fff2c3')
  assert.equal(block.prizeMobileLayout.rows[1].groups[0].rowColor, '#ffdf76')
})

test('upgrades old shared orange and gray HTML colors to the named group palette', () => {
  const source = '<table><caption style="background-color:#c95b0c;color:#ffffff">场地越野赛（女子组）奖金设置</caption><thead><tr><th colspan="2" style="background-color:#d7d7d7">排位赛奖金</th><th colspan="2" style="background-color:#d7d7d7">预赛奖金</th><th colspan="2" style="background-color:#d7d7d7">决赛奖金</th></tr></thead><tbody><tr><td style="background-color:#d7d7d7">第一名</td><td style="background-color:#d7d7d7">3000</td><td style="background-color:#d7d7d7">第一名</td><td style="background-color:#d7d7d7">5000</td><td style="background-color:#d7d7d7">第一名</td><td style="background-color:#d7d7d7">10000</td></tr><tr><td colspan="2" style="background-color:#c95b0c">合计：6000元</td><td colspan="2" style="background-color:#c95b0c">合计：15000元</td><td colspan="2" style="background-color:#c95b0c">合计：31000元</td></tr></tbody></table>'
  const html = convertGroupedPrizeTables(source)

  assert.match(html, /class="mini-preview-mobile-prize-title"[^>]*background-color:#8e5aa8;color:#ffffff">场地越野赛（女子组）/)
  assert.match(html, /background-color:#e2d0eb/)
  assert.match(html, /background-color:#f5edf8/)
})

test('normalizes legacy full-page stage headings to the reference wording', () => {
  const html = `<table><caption>场地越野赛（专业组）奖金设置 11.5万元</caption><thead><tr><th colspan="2">排位赛</th><th colspan="2">预赛</th><th colspan="2">决赛</th></tr></thead><tbody><tr><td>第一名</td><td>5000</td><td>第一名</td><td>10000</td><td>第一名</td><td>30000</td></tr></tbody></table>`
  const mobileHtml = convertGroupedPrizeTables(repairPrizeTableColspans(html))

  assert.match(mobileHtml, /排位赛奖金/)
  assert.match(mobileHtml, /预赛奖金/)
  assert.match(mobileHtml, /决赛奖金/)
})

test('repairs unspanned three-stage headers before converting them', () => {
  const unspanned = professionalPrizeTable.replaceAll(' colspan="2"', '')
  const html = convertGroupedPrizeTables(repairPrizeTableColspans(unspanned))

  assert.equal((html.match(/mini-preview-mobile-prize-three-stage-group/g) || []).length, 3)
  assert.match(html, /mini-preview-mobile-prize-three-stage-total/)
})

test('keeps all four groups in one matrix with eight body cells per row', () => {
  const legacy = `<table><caption>坦克汽车（定向集结赛）奖金设置 19.2万元</caption><thead><tr><th>公开 A组</th><th>公开 B组</th><th>公开 C组</th><th>公开 D组</th></tr></thead><tbody><tr><td>第一名</td><td>20000</td><td>第一名</td><td>20000</td><td>第一名</td><td>20000</td><td>第一名</td><td>20000</td></tr><tr><td>第十名</td><td>1000</td><td>第十名</td><td>1000</td><td>第十名</td><td>1000</td><td>第十名</td><td>1000</td></tr></tbody></table>`
  const html = convertGroupedPrizeTables(repairPrizeTableColspans(legacy))

  assert.equal((html.match(/mini-preview-mobile-prize-matrix/g) || []).length, 1)
  assert.equal((html.match(/class="mini-preview-mobile-prize-group"/g) || []).length, 0)
  for (const group of ['公开 A组', '公开 B组', '公开 C组', '公开 D组']) assert.match(html, new RegExp(group.replace(' ', '\\s*')))
  assert.equal((html.match(/20000/g) || []).length, 4)
  assert.equal((html.match(/1000/g) || []).length, 4)
  assert.match(html, /background-color:#0879c9/)
  assert.match(html, /white-space:nowrap/)
  assert.doesNotMatch(html, /<table\b/i)
})

test('splits compact four-group HTML rows into name and prize cells', () => {
  const compact = `<table><thead><tr><th colspan="2">公开A组</th><th colspan="2">公开B组</th><th colspan="2">公开C组</th><th colspan="2">公开D组</th></tr></thead><tbody><tr><td>第一名：20000</td><td>第一名：18000</td><td>第一名：16000</td><td>第一名：14000</td></tr></tbody></table>`
  const html = convertGroupedPrizeTables(repairPrizeTableColspans(compact))

  assert.equal((html.match(/mini-preview-mobile-prize-matrix/g) || []).length, 1)
  assert.equal((html.match(/第一名/g) || []).length, 4)
  assert.equal((html.match(/20000/g) || []).length, 1)
  assert.match(html, /第一名<\/div>[\s\S]*>20000<\/div>/)
})

test('adds inline contrast to saved prize titles without replacing a custom text color', () => {
  const html = normalizePrizeTitleColors('<div class="mini-preview-prize-title" style="background-color:#c95b0c">专业组奖金设置</div><div class="mini-preview-prize-title" style="background-color:#c95b0c">UTV组奖金设置</div><div class="mini-preview-prize-title" style="background-color:#ffc313;color:#111">新秀组奖金设置</div>')

  assert.match(html, /background-color:#c95b0c[^\"]*color:#fff/)
  assert.match(html, /background-color:#4f812f[^>]*>UTV组奖金设置/)
  assert.match(html, /background-color:#ffc313;color:#111/)
  assert.match(html, /padding:9px 6px/)
  assert.match(html, /text-align:center/)
  assert.match(html, /font-size:13\.5px/)
})

test('builds the three-stage mobile table layout with merged stage headers and merged subtotals', () => {
  const layout = prizeTableMobileLayout(
    ['排位赛奖金', '奖金', '预赛奖金', '奖金', '决赛奖金', '奖金'],
    [
      ['第一名', '5000', '第一名', '10000', '第一名', '30000'],
      ['--', '--', '第四名', '3000', '第四名', '6000'],
      ['小计', '9000元', '小计', '25000', '小计', '81000元']
    ],
    '场地越野赛（专业组）奖金设置 11.5万元'
  )

  assert.equal(layout.type, 'stages')
  assert.deepEqual(layout.groups.map(group => group.label), ['排位赛奖金', '预赛奖金', '决赛奖金'])
  assert.deepEqual(layout.rows[0].groups[0], { rank: '第一名', prize: '5000', rowColor: '#d6d6d6' })
  assert.deepEqual(layout.rows[1].groups[0], { rank: '--', prize: '--', rowColor: '#e2e2e2' })
  assert.deepEqual(layout.rows[2].groups.map(group => group.totalText), ['小计：9000元', '小计：25000', '小计：81000元'])
})

test('expands legacy compact stage tables into the same mobile layout', () => {
  const layout = prizeTableMobileLayout(
    ['排位赛奖金', '预赛奖金', '决赛奖金'],
    [['第一名：5000', '第一名：10000', '第一名：30000'], ['小计：9000元', '小计：25000元', '小计：81000元']],
    '场地越野赛（专业组）奖金设置 11.5万元'
  )

  assert.equal(layout.type, 'stages')
  assert.deepEqual(layout.rows[0].groups[2], { rank: '第一名', prize: '30000', rowColor: '#d6d6d6' })
  assert.deepEqual(layout.rows[1].groups.map(group => group.totalText), ['小计：9000元', '小计：25000元', '小计：81000元'])
})

test('shows the three-stage labels and six compact cells when saved body headers omit 奖金', () => {
  const layout = prizeTableMobileLayout(
    ['排位赛', '奖金', '预赛', '奖金', '决赛', '奖金'],
    [['第一名', '5000', '第一名', '10000', '第一名', '30000']],
    '场地越野赛（专业组）奖金设置 11.5万元'
  )

  assert.equal(layout.type, 'stages')
  assert.deepEqual(layout.groups.map(group => group.label), ['排位赛奖金', '预赛奖金', '决赛奖金'])
  assert.deepEqual(layout.rows[0].groups, [
    { rank: '第一名', prize: '5000', rowColor: '#d6d6d6' },
    { rank: '第一名', prize: '10000', rowColor: '#d6d6d6' },
    { rank: '第一名', prize: '30000', rowColor: '#d6d6d6' }
  ])
})

test('renders all four prize groups as one visible matrix instead of a selector', () => {
  const labels = ['公开 A组', '奖金', '公开 B组', '奖金', '公开 C组', '奖金', '公开 D组', '奖金']
  const row = ['第一名', '20000', '第一名', '20000', '第一名', '20000', '第一名', '20000']
  const layout = prizeTableMobileLayout(labels, [row], '公开组奖金设置')

  assert.equal(layout.type, 'matrix')
  assert.deepEqual(layout.groups.map(group => group.label), ['公开 A组', '公开 B组', '公开 C组', '公开 D组'])
  assert.deepEqual(layout.rows[0].groups[3], {
    rank: '第一名', prize: '20000', isTotal: false,
    rowColor: '#fff8f9', borderColor: '#e0a3ad'
  })
  assert.deepEqual(layout.groups.map(group => group.titleColor), Array(4).fill('#850016'))
})

test('keeps compact four-group rows aligned to their own group', () => {
  const layout = prizeTableMobileLayout(
    ['公开A组', '奖金', '公开B组', '奖金', '公开C组', '奖金', '公开D组', '奖金'],
    [['第一名：20000', '第一名：18000', '第一名：16000', '第一名：14000'], ['小计：20000元', '小计：18000元', '小计：16000元', '小计：14000元']],
    '定向集结赛奖金设置'
  )

  assert.equal(layout.type, 'matrix')
  assert.deepEqual(layout.rows[0].groups.map(group => group.prize), ['20000', '18000', '16000', '14000'])
  assert.deepEqual(layout.rows[1].groups.map(group => group.totalText), ['小计：20000元', '小计：18000元', '小计：16000元', '小计：14000元'])
})

test('recognizes compact four-group tables when each header names one group', () => {
  const layout = prizeTableMobileLayout(
    ['公开A组', '公开B组', '公开C组', '公开D组'],
    [['第一名：20000', '第一名：18000', '第一名：16000', '第一名：14000']],
    '定向集结赛奖金设置'
  )

  assert.equal(layout.type, 'matrix')
  assert.deepEqual(layout.groups.map(group => group.label), ['公开A组', '公开B组', '公开C组', '公开D组'])
  assert.deepEqual(layout.rows[0].groups.map(group => [group.rank, group.prize]), [
    ['第一名', '20000'], ['第一名', '18000'], ['第一名', '16000'], ['第一名', '14000']
  ])
})

test('leaves a regular six-column table on the ordinary table renderer', () => {
  assert.equal(prizeTableMobileLayout(['姓名', '组别', '赛段', '用时', '成绩', '备注'], [['甲', 'A', 'SS1', '1:20', '第1名', '']], '参赛成绩'), null)
})

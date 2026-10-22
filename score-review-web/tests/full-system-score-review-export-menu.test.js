'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { test } = require('node:test')

test('export dropdown is click-controlled, wide enough for labels, and closes after selection', () => {
  const html = fs.readFileSync(path.join(__dirname, '../../full-system/index.html'), 'utf8')
  const start = html.indexOf('data-export-menu role="menu"')
  assert.notEqual(start, -1, 'export menu should be rendered only while open')
  const menuStart = html.lastIndexOf('<div className="relative" ref={exportMenuRef}>', start)
  const end = html.indexOf('</div>}', start)
  const dropdown = html.slice(menuStart, end + 7)
  assert.match(dropdown, /aria-expanded={exportMenuOpen}/)
  assert.match(dropdown, /setExportMenuOpen\(open=>!open\)/)
  assert.match(html, /addEventListener\('mousedown',closeOnOutside\)/)
  assert.match(html, /addEventListener\('keydown',closeOnEscape\)/)
  assert.match(dropdown, /min-w-\[176px\] whitespace-nowrap/)
  assert.equal((dropdown.match(/setExportMenuOpen\(false\)/g) || []).length, 2)
  assert.doesNotMatch(dropdown, /group-hover:block/)
  assert.ok(dropdown.indexOf('</button>') < dropdown.indexOf('data-export-menu'), 'menu must not be nested inside its toggle button')
})

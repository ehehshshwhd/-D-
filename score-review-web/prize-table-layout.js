(function(root, factory) {
  const api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  else root.PrizeTableLayout = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  function normalizeStageLabel(value) {
    const label = String(value || '').replace(/\s+/g, ' ').trim()
    return /^(?:排位赛|预赛|决赛)$/.test(label) ? `${label}奖金` : label
  }

  function inferPrizeTheme(title) {
    const value = String(title || '')
    if (/(?:坦克汽车|定向集结赛)/.test(value)) return 'blue'
    if (/专业组/.test(value)) return 'orange'
    if (/公开\s*A组/.test(value)) return 'maroon'
    if (/公开\s*B组/.test(value)) return 'green'
    if (/公开\s*C组/.test(value)) return 'yellow'
    if (/公开\s*D组/.test(value)) return 'purple'
    if (/公开组/.test(value)) return 'maroon'
    if (/UTV/i.test(value)) return 'green'
    if (/新秀组/.test(value)) return 'yellow'
    if (/女子组/.test(value)) return 'purple'
    if (/改装组/.test(value)) return 'charcoal'
    if (/量产组/.test(value)) return 'yellow'
    return 'blue'
  }

  function inferPrizeGroupCount(headerLabels, bodyWidth, hasSpannedHeaders = false, compactGroupRows = false) {
    const labels = Array.isArray(headerLabels) ? headerLabels.map(value => String(value || '').replace(/\s+/g, ' ').trim()) : []
    const headerCount = labels.length
    if (headerCount < 3) return 0
    const combined = labels.join(' ')
    const looksLikeStages = headerCount === 3 && /(?:奖金|排位|预赛|决赛)/i.test(combined)
    if (looksLikeStages) return 3
    if (hasSpannedHeaders) return headerCount

    // In old prize tables one header names a group while the corresponding
    // body data is stored as two columns: rank and prize. Infer that shape
    // from the body width; the previous code incorrectly divided the number
    // of group headers by two and silently dropped groups C/D.
    const looksLikeGroups = /组|公开\s*[A-ZＡ-Ｚ]/i.test(combined)
    if (looksLikeGroups && (bodyWidth === headerCount * 2 || compactGroupRows && bodyWidth === headerCount)) return headerCount
    if (bodyWidth >= headerCount * 2 && looksLikeGroups) return headerCount
    return Math.floor(bodyWidth / 2) || Math.floor(headerCount / 2)
  }

  function isCompactStageTable(headerLabels, bodyWidth) {
    const labels = Array.isArray(headerLabels) ? headerLabels.map(value => String(value || '').replace(/\s+/g, ' ').trim()) : []
    return labels.length === 3 && bodyWidth === 3 && /(?:奖金|排位|预赛|决赛)/i.test(labels.join(' '))
  }

  function splitGroupedPrizeTable(headerLabels, sourceRows) {
    const headers = Array.isArray(headerLabels) ? headerLabels.map(value => String(value || '').replace(/\s+/g, ' ').trim()) : []
    const rows = Array.isArray(sourceRows) ? sourceRows.map(row => Array.isArray(row) ? row.map(value => String(value ?? '').trim()) : []) : []
    if (headers.length < 8 || headers.length % 2 !== 0) return []

    const groupCount = headers.length / 2
    return Array.from({ length: groupCount }, (_, groupIndex) => {
      const header = headers[groupIndex * 2]
      const label = (header || `第${groupIndex + 1}组`).replace(/(?:名次|奖金)\s*$/, '').trim() || `第${groupIndex + 1}组`
      const groupRows = rows.map((row, rowIndex) => {
        const isTotal = rowIndex === rows.length - 1 && row.some(cell => /^(小计|合计)/.test(cell))
        if (row.length === groupCount) {
          if (/^(小计|合计)/.test(row[groupIndex])) return [row[groupIndex], '']
          const match = row[groupIndex].match(/^(.+?)[：:]\s*(.+)$/)
          return match ? [match[1].trim(), match[2].trim()] : [row[groupIndex], row[groupIndex] === '--' ? '--' : '']
        }
        const offset = groupIndex * 2
        const first = row[offset] || '', second = row[offset + 1] || ''
        if (isTotal && row.length === groupCount) return [first, '']
        if (/^(小计|合计)/.test(first)) return [first, '']
        return [first, second]
      })
      return { label, rows: groupRows }
    })
  }

  function serializePrizeGroups({ title = '', groups = [] } = {}) {
    const normalizedGroups = Array.isArray(groups) ? groups.map(group => ({
      label: String(group?.label || '').trim(),
      rows: Array.isArray(group?.rows) ? group.rows.map(row => Array.isArray(row) ? row.map(value => String(value ?? '').trim()) : []) : [],
      palette: group?.palette && typeof group.palette === 'object' ? { ...group.palette } : {},
    })) : []
    const headers = normalizedGroups.flatMap(group => [`${group.label || '组'}名次`, '奖金'])
    const rowCount = Math.max(0, ...normalizedGroups.map(group => group.rows.length))
    const rows = Array.from({ length: rowCount }, (_, rowIndex) => normalizedGroups.flatMap(group => {
      const row = group.rows[rowIndex] || []
      if (row.length === 1 && /^(?:小计|合计)/.test(row[0])) return [row[0], '']
      return [row[0] || '', row[1] || '']
    }))
    return {
      type: 'table',
      title: String(title || '').trim(),
      headers,
      rows,
      groupPalettes: normalizedGroups.map(group => group.palette),
    }
  }

  function groupedPrizeBlockToGroups(block) {
    const rawHeaders = Array.isArray(block?.headers) ? block.headers.map(value => String(value ?? '').trim()) : []
    const headers = rawHeaders.length >= 8 ? rawHeaders : rawHeaders.length >= 4 ? rawHeaders.flatMap(label => [`${label}名次`, '奖金']) : []
    const rows = Array.isArray(block?.rows) ? block.rows.map(row => Array.isArray(row) ? row.map(value => String(value ?? '').trim()) : []) : []
    if (headers.length < 8 || headers.length % 2 !== 0) return []
    return splitGroupedPrizeTable(headers, rows).map((group, index) => ({
      ...group,
      palette: Array.isArray(block.groupPalettes) && block.groupPalettes[index] && typeof block.groupPalettes[index] === 'object'
        ? { ...block.groupPalettes[index] }
        : {},
    }))
  }

  return { inferPrizeGroupCount, inferPrizeTheme, isCompactStageTable, normalizeStageLabel, splitGroupedPrizeTable, serializePrizeGroups, groupedPrizeBlockToGroups }
})

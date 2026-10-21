const cellPattern = /<(th|td)\b([^>]*)>([\s\S]*?)<\/\1\s*>/gi
const rowPattern = /<tr\b[^>]*>[\s\S]*?<\/tr\s*>/gi

function textOf(html) {
  return String(html || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim()
}

function normalizePrizeStageLabel(value) {
  const label = String(value == null ? '' : value).replace(/\s+/g, ' ').trim()
  return /^(?:排位赛|预赛|决赛)$/.test(label) ? `${label}奖金` : label
}

function cellSpan(attrs) {
  const span = Number.parseInt((String(attrs || '').match(/\bcolspan\s*=\s*["']?(\d+)/i) || [])[1], 10)
  return Number.isInteger(span) && span > 0 ? span : 1
}

const groupPalettes = [
  { titleColor: '#850016', headerColor: '#f4dfe3', bodyColor: '#fff8f9', stripeColor: '#f9eaed', totalColor: '#850016', textColor: '#111111', totalTextColor: '#ffffff', borderColor: '#e0a3ad' },
  { titleColor: '#4f812f', headerColor: '#a8d18d', bodyColor: '#c7e2b8', stripeColor: '#b5d99f', totalColor: '#4f812f', textColor: '#111111', totalTextColor: '#ffffff', borderColor: '#ffffff' },
  { titleColor: '#ffba00', headerColor: '#ffda63', bodyColor: '#fff2c3', stripeColor: '#ffdf76', totalColor: '#d58c00', textColor: '#111111', totalTextColor: '#111111', borderColor: '#ffffff' },
  { titleColor: '#5968a8', headerColor: '#cbd2ef', bodyColor: '#e8ebfa', stripeColor: '#d9def4', totalColor: '#5968a8', textColor: '#111111', totalTextColor: '#ffffff', borderColor: '#ffffff' },
  { titleColor: '#c95b0c', headerColor: '#f5d4b8', bodyColor: '#fff3e7', stripeColor: '#fbe2cf', totalColor: '#c95b0c', textColor: '#111111', totalTextColor: '#ffffff', borderColor: '#ffffff' },
  { titleColor: '#8e5aa8', headerColor: '#e2d0eb', bodyColor: '#f5edf8', stripeColor: '#eaddf0', totalColor: '#8e5aa8', textColor: '#111111', totalTextColor: '#ffffff', borderColor: '#ffffff' }
]

function prizeGroupPalette(index) {
  return { ...groupPalettes[index % groupPalettes.length] }
}

function prizeThemeForTitle(titleValue) {
  const title = String(titleValue || '')
  if (/(?:坦克汽车|定向集结赛)/.test(title)) return 'blue'
  if (/专业组/.test(title)) return 'orange'
  if (/公开\s*A组/.test(title)) return 'maroon'
  if (/公开\s*B组/.test(title)) return 'green'
  if (/公开\s*C组/.test(title)) return 'yellow'
  if (/公开\s*D组/.test(title)) return 'purple'
  if (/公开组/.test(title)) return 'maroon'
  if (/UTV/i.test(title)) return 'green'
  if (/新秀组/.test(title)) return 'yellow'
  if (/女子组/.test(title)) return 'purple'
  if (/改装组/.test(title)) return 'charcoal'
  if (/量产组/.test(title)) return 'yellow'
  return 'orange'
}

function prizeThemePalette(theme) {
  const palettes = {
    orange: { titleColor: '#c95b0c', headerColor: '#dedede', bodyColor: '#d6d6d6', stripeColor: '#e2e2e2', totalColor: '#c95b0c', textColor: '#222222', totalTextColor: '#ffffff', borderColor: '#ffffff' },
    maroon: prizeGroupPalette(0),
    green: prizeGroupPalette(1),
    yellow: prizeGroupPalette(2),
    purple: prizeGroupPalette(5),
    blue: { titleColor: '#0879c9', headerColor: '#ffffff', bodyColor: '#ffffff', stripeColor: '#f7fbff', totalColor: '#0879c9', textColor: '#222222', totalTextColor: '#ffffff', borderColor: '#d6e4ef' },
    charcoal: { titleColor: '#414141', headerColor: '#d4d4d4', bodyColor: '#e9e9e9', stripeColor: '#d4d4d4', totalColor: '#414141', textColor: '#222222', totalTextColor: '#ffffff', borderColor: '#ffffff' }
  }
  return { ...(palettes[theme] || palettes.orange) }
}

function prizeGroupPaletteForLabel(labelValue, index) {
  const label = String(labelValue || '')
  if (/(?:专业组|公开\s*[A-DＡ-Ｄ]组|公开组|UTV组|新秀组|女子组|改装组|量产组)/i.test(label)) {
    return prizeThemePalette(prizeThemeForTitle(label))
  }
  return prizeGroupPalette(index)
}

function normalizePrizeTableColors(blockValue) {
  const block = blockValue && typeof blockValue === 'object' ? blockValue : {}
  const title = String(block.title || '')
  const palette = prizeThemePalette(prizeThemeForTitle(title))
  const validColor = (value, fallback, generic) => {
    const color = /^#[0-9a-f]{6}$/i.test(String(value || '')) ? String(value).toLowerCase() : ''
    return !color || color === generic ? fallback : color
  }
  const headers = Array.isArray(block.headers) ? block.headers : []
  const rows = Array.isArray(block.rows) ? block.rows : []
  const bodyColor = validColor(block.bodyColor, palette.bodyColor, '#d7d7d7')
  const stripeColor = validColor(block.stripeColor, palette.stripeColor || palette.bodyColor, '#e2e2e2')
  const totalColor = validColor(block.totalColor, palette.totalColor, '#c95b0c')
  return {
    titleColor: validColor(block.titleColor, palette.titleColor, '#c95b0c'),
    headerColor: validColor(block.headerColor, palette.headerColor, '#d7d7d7'),
    bodyColor,
    stripeColor,
    totalColor,
    textColor: validColor(block.textColor, palette.textColor, '#222222'),
    titleTextColor: validColor(block.titleTextColor, palette.totalTextColor, '#ffffff'),
    totalTextColor: validColor(block.totalTextColor, palette.totalTextColor, '#ffffff'),
    prizeMobileLayout: prizeTableMobileLayout(headers, rows, title, { bodyColor, stripeColor, totalColor })
  }
}

function prizeTableMobileLayout(headersValue, rowsValue, titleValue, paletteValue) {
  const headers = Array.isArray(headersValue) ? headersValue.map(value => String(value == null ? '' : value).trim()) : []
  const rows = Array.isArray(rowsValue) ? rowsValue.filter(Array.isArray).map(row => row.map(value => String(value == null ? '' : value).trim())) : []
  const compactStages = headers.length === 3 && /(?:排位|预赛|决赛)/.test(headers.join(' '))
  const bodyWidth = Math.max(0, ...rows.map(row => row.length))
  const compactGroups = headers.length >= 4 && bodyWidth === headers.length &&
    headers.every(label => /(?:组|UTV|新秀|女子)/i.test(label)) &&
    rows.some(row => row.some(cell => /[^：:]+[：:]/.test(cell)))
  const stagePairHeaders = headers.length === 6 && /(?:排位|预赛|决赛)/.test(headers.filter((_, index) => index % 2 === 0).join(' '))
  const pairedHeaders = stagePairHeaders || (headers.length >= 8 && headers.length % 2 === 0)
  const spannedGroupHeaders = headers.length >= 4 && headers.length < 8 && bodyWidth >= headers.length * 2
  if (!compactStages && !compactGroups && !pairedHeaders && !spannedGroupHeaders) return null

  const groupCount = compactStages ? 3 : compactGroups ? headers.length : (pairedHeaders ? headers.length / 2 : headers.length)
  const groupLabels = (compactStages ? headers : Array.from({ length: groupCount }, (_, index) => {
    const label = pairedHeaders ? headers[index * 2] : headers[index]
    return label || `第${index + 1}组`
  })).map(label => /组/i.test(label) ? label.replace(/(?:名次|奖金)\s*$/i, '').trim() : normalizePrizeStageLabel(label))
  const title = String(titleValue || '')
  const stagePalette = { ...prizeThemePalette(prizeThemeForTitle(title)), ...(paletteValue && typeof paletteValue === 'object' ? paletteValue : {}) }
  const looksLikeStages = (compactStages || stagePairHeaders) && groupCount === 3 && /(?:排位|预赛|决赛)/.test(groupLabels.join(' ')) &&
    groupLabels.every(label => /(?:排位|预赛|决赛)/.test(label))
  const looksLikeClassGroups = groupCount >= 4 && /(?:组|公开\s*[A-ZＡ-Ｚ]|UTV|新秀|女子)/i.test(groupLabels.join(' '))
  if (!looksLikeStages && !looksLikeClassGroups) return null

  const isTotalRow = (row, index) => index === rows.length - 1 && row.some(cell => /^(?:小计|合计)/.test(cell))
  const makePair = (row, groupIndex, index) => {
    const total = isTotalRow(row, index)
    if (compactStages) {
      const value = row[groupIndex] || ''
      if (total) return { totalText: value }
      const match = value.match(/^(.+?)[：:]\s*(.+)$/)
      return match ? { rank: match[1].trim(), prize: match[2].trim() } : { rank: value, prize: value === '--' ? '--' : '' }
    }
    if (row.length === groupCount) {
      const value = row[groupIndex] || ''
      if (total) return { totalText: value }
      const match = value.match(/^(.+?)[：:]\s*(.+)$/)
      return match ? { rank: match[1].trim(), prize: match[2].trim() } : { rank: value, prize: value === '--' ? '--' : '' }
    }
    const start = (pairedHeaders || spannedGroupHeaders) ? groupIndex * 2 : groupIndex
    const first = row[start] || ''
    const second = pairedHeaders ? (row[start + 1] || '') : ''
    if (total) return { totalText: first && second ? `${first}：${second}` : first || second }
    return { rank: first, prize: second }
  }

  if (looksLikeStages) {
    return {
      type: 'stages',
      groups: groupLabels.map(label => ({ label })),
      rows: rows.map((row, index) => {
        const isTotal = isTotalRow(row, index)
        return {
          isTotal,
          groups: groupLabels.map((_, groupIndex) => ({
            ...makePair(row, groupIndex, index),
            rowColor: isTotal ? stagePalette.totalColor : (index % 2 ? stagePalette.stripeColor : stagePalette.bodyColor)
          }))
        }
      })
    }
  }

  const isFourGroupMatrix = groupLabels.length === 4
  const groups = groupLabels.map((label, groupIndex) => {
    const palette = isFourGroupMatrix ? stagePalette : prizeGroupPaletteForLabel(label, groupIndex)
    return {
      label,
      ...palette,
      rows: rows.map((row, index) => ({
        ...makePair(row, groupIndex, index),
        isTotal: isTotalRow(row, index),
        rowColor: index % 2 ? palette.stripeColor : palette.bodyColor,
        borderColor: palette.borderColor
      }))
    }
  })
  if (isFourGroupMatrix) {
    return {
      type: 'matrix',
      groups: groups.map(({ rows: _rows, ...group }) => group),
      rows: rows.map((_, rowIndex) => ({
        isTotal: isTotalRow(rows[rowIndex], rowIndex),
        groups: groups.map(group => group.rows[rowIndex])
      }))
    }
  }
  return { type: 'groups', groups }
}

function styleOf(attrs) {
  const match = String(attrs || '').match(/\bstyle\s*=\s*["']([^"']*)["']/i)
  if (!match) return ''
  const allowed = new Set(['background-color', 'color', 'font-weight', 'font-style', 'text-align', 'text-decoration'])
  return match[1].split(';').map(part => {
    const index = part.indexOf(':')
    if (index < 0) return ''
    const property = part.slice(0, index).trim().toLowerCase()
    const declaration = part.slice(index + 1).trim()
    if (!allowed.has(property) || !declaration || /[<>"']/g.test(declaration)) return ''
    return `${property}:${declaration}`
  }).filter(Boolean).join(';')
}

function colorFromStyle(style, property, fallback) {
  const value = String(style || '').match(new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`, 'i'))?.[1]?.trim()
  return value || fallback
}

function colorFromStyleWithThemeFallback(style, property, fallback, genericColors) {
  const value = colorFromStyle(style, property, '').toLowerCase()
  return !value || genericColors.includes(value) ? fallback : value
}

function normalizePrizeTitleColors(value) {
  const source = String(value || '')
  return source.replace(/<(div|p|span)\b([^>]*)>/gi, (tag, element, attrs, offset) => {
    const classMatch = attrs.match(/\bclass\s*=\s*(["'])(.*?)\1/i)
    if (!classMatch || !/(?:^|\s)mini-preview-prize-title(?:\s|$)/i.test(classMatch[2])) return tag
    const styleMatch = attrs.match(/\bstyle\s*=\s*(["'])(.*?)\1/i)
    const style = styleMatch ? styleMatch[2] : ''
    const background = colorFromStyle(style, 'background-color', '').match(/^#([\da-f]{3}|[\da-f]{6})$/i)?.[1]
    const titleInner = source.slice(offset + tag.length).match(new RegExp(`^([\\s\\S]*?)<\\/${element}\\s*>`, 'i'))?.[1] || ''
    const titleText = textOf(titleInner)
    const palette = prizeThemePalette(prizeThemeForTitle(titleText))
    const isLegacySharedColor = /^(?:c95b0c|d45500)$/i.test(background || '')
    let nextStyle = style
    if (isLegacySharedColor && titleText && /(?:专业组|公开|UTV|新秀|女子组)/i.test(titleText)) {
      nextStyle = /(?:^|;)\s*background-color\s*:/i.test(nextStyle)
        ? nextStyle.replace(/(^|;)\s*background-color\s*:[^;]*/i, `$1background-color:${palette.titleColor}`)
        : `${nextStyle}${nextStyle.trim() ? ';' : ''}background-color:${palette.titleColor}`
    }
    let textColor = isLegacySharedColor && titleText && /(?:专业组|公开|UTV|新秀|女子组)/i.test(titleText)
      ? palette.totalTextColor
      : colorFromStyle(style, 'color', '')
    if (!textColor && background) {
      const hex = background.length === 3 ? background.split('').map(part => part + part).join('') : background
      const channels = [0, 2, 4].map(index => parseInt(hex.slice(index, index + 2), 16) / 255).map(channel => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
      const luminance = 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
      textColor = luminance > 0.45 ? '#111' : '#fff'
    }
    const ensureStyle = (value, property, fallback) => new RegExp(`(?:^|;)\\s*${property}\\s*:`, 'i').test(value) ? value : `${value.replace(/;\s*$/, '')}${value.trim() ? ';' : ''}${property}:${fallback}`
    nextStyle = ensureStyle(nextStyle, 'padding', '9px 6px')
    nextStyle = ensureStyle(nextStyle, 'text-align', 'center')
    nextStyle = ensureStyle(nextStyle, 'font-size', '13.5px')
    nextStyle = ensureStyle(nextStyle, 'font-weight', '700')
    nextStyle = ensureStyle(nextStyle, 'line-height', '1.4')
    if (textColor) nextStyle = ensureStyle(nextStyle, 'color', textColor)
    if (!styleMatch) return `<${element}${attrs} style="${nextStyle}">`
    const nextAttrs = attrs.replace(styleMatch[0], `style=${styleMatch[1]}${nextStyle}${styleMatch[1]}`)
    return `<${element}${nextAttrs}>`
  })
}

function repairPrizeTableColspans(value) {
  const source = String(value || '')
  return source.replace(/<table\b[^>]*>[\s\S]*?<\/table\s*>/gi, tableHtml => {
    const headMatch = tableHtml.match(/<thead\b[^>]*>[\s\S]*?<tr\b[^>]*>([\s\S]*?)<\/tr\s*>[\s\S]*?<\/thead\s*>/i)
    const headerInner = headMatch ? headMatch[1] : (tableHtml.match(/<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/i) || [])[1]
    if (!headerInner) return tableHtml
    const headerCells = [...headerInner.matchAll(cellPattern)]
    if (headerCells.length < 3) return tableHtml
    const bodyMatch = tableHtml.match(/<tbody\b[^>]*>([\s\S]*?)<\/tbody\s*>/i)
    const bodyRows = [...(bodyMatch ? bodyMatch[1] : tableHtml).matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi)]
    const bodyWidth = Math.max(0, ...bodyRows.map(row => [...row[1].matchAll(cellPattern)].reduce((sum, cell) => sum + cellSpan(cell[2]), 0)))
    const labels = headerCells.map(cell => textOf(cell[3])).join(' ')
    if (bodyWidth < headerCells.length * 2 || !/(奖金|名次|排位|预赛|决赛|公开[A-ZＡ-Ｚ]|组名|组)/i.test(labels)) return tableHtml
    const repairedHeader = headerInner.replace(cellPattern, (full, tag, attrs, inner) => /\bcolspan\s*=/i.test(attrs) ? full : `<${tag}${attrs} colspan="2">${inner}</${tag}>`)
    return headMatch ? tableHtml.replace(headMatch[1], repairedHeader) : tableHtml.replace(headerInner, repairedHeader)
  })
}

function convertThreeStagePrizeTable(headerCells, bodyRows, caption, adjacentTitle = '') {
  const headers = headerCells.map(cell => normalizePrizeStageLabel(textOf(cell[3])))
  const titlePalette = prizeThemePalette(prizeThemeForTitle(caption ? textOf(caption[2]) : adjacentTitle))
  const firstBodyCell = bodyRows.flatMap(row => [...row[0].matchAll(cellPattern)]).find(cell => !/^(小计|合计)/.test(textOf(cell[3])))
  const firstTotalCell = bodyRows.flatMap(row => [...row[0].matchAll(cellPattern)]).find(cell => /^(小计|合计)/.test(textOf(cell[3])))
  const headerBackground = colorFromStyleWithThemeFallback(styleOf(headerCells[0][2]), 'background-color', titlePalette.headerColor, ['#d7d7d7', '#dedede', '#eaf3fb'])
  const bodyBackground = colorFromStyleWithThemeFallback(styleOf(firstBodyCell?.[2]), 'background-color', titlePalette.bodyColor, ['#d7d7d7', '#d6d6d6', '#f2f2f2'])
  const totalBackground = colorFromStyleWithThemeFallback(styleOf(firstTotalCell?.[2]), 'background-color', titlePalette.totalColor, ['#c95b0c'])
  const titleBackground = caption ? colorFromStyleWithThemeFallback(styleOf(caption[1]), 'background-color', titlePalette.titleColor, ['#c95b0c']) : titlePalette.titleColor
  const titleText = caption ? colorFromStyleWithThemeFallback(styleOf(caption[1]), 'color', titlePalette.totalTextColor, ['#fff', '#ffffff']) : titlePalette.totalTextColor
  const title = caption ? `<div class="mini-preview-mobile-prize-title" style="display:block;width:100%;box-sizing:border-box;padding:10px 6px;text-align:center;font-size:14px;font-weight:700;line-height:1.35;background-color:${titleBackground};color:${titleText}">${caption[2]}</div>` : ''
  const wrapperStyle = 'display:block;width:100%;max-width:100%;min-width:0;box-sizing:border-box;overflow:hidden;font-size:11px;line-height:1.3;color:#111'
  const headRow = `<div class="mini-preview-mobile-prize-three-stage-head" style="display:flex;width:100%;box-sizing:border-box;background-color:${headerBackground};font-weight:700">${headers.map(header => `<div class="mini-preview-mobile-prize-three-stage-group" style="display:flex;flex:1 1 0;min-width:0;box-sizing:border-box;align-items:center;justify-content:center;padding:7px 2px;text-align:center;line-height:1.25;border-right:1px solid #fff;overflow-wrap:anywhere">${header}</div>`).join('')}</div>`
  const rowsMarkup = bodyRows.map((row, rowIndex) => {
    const cells = [...row[0].matchAll(cellPattern)]
    if (!cells.length) return ''
    const isTotal = /mini-preview-prize-total-row/i.test(row[0]) || cells.some(cell => /^(小计|合计)/.test(textOf(cell[3])))
    const stages = Array.from({ length: 3 }, (_, groupIndex) => {
      const selected = isTotal && cells.length === 3
        ? [cells[groupIndex]]
        : cells.length === 3
          ? [cells[groupIndex]]
          : cells.slice(groupIndex * 2, groupIndex * 2 + 2)
      if (!selected.length) return ''
      const displayCells = isTotal && selected.length === 2 ? [[selected[0][0], '', selected.map(cell => cell[3]).join(' ')]] : selected
      const cellMarkup = displayCells.map(cell => {
        const rowBackground = isTotal ? totalBackground : (rowIndex % 2 ? titlePalette.stripeColor || bodyBackground : bodyBackground)
        const baseStyle = 'display:flex;flex:1 1 0;min-width:0;box-sizing:border-box;align-items:center;justify-content:center;padding:8px 1px;text-align:center;line-height:1.25;white-space:nowrap;word-break:keep-all;overflow:hidden;border-right:1px solid #fff;border-bottom:1px solid #fff;background-color:' + rowBackground + ';' + (isTotal ? `color:${titlePalette.totalTextColor};font-weight:700` : 'color:#111;font-weight:700')
        return `<div class="${isTotal ? 'mini-preview-mobile-prize-three-stage-total-cell' : 'mini-preview-mobile-prize-three-stage-cell'}" style="${baseStyle}">${cell[3]}</div>`
      }).join('')
      const stageClass = isTotal ? 'mini-preview-mobile-prize-three-stage-total' : 'mini-preview-mobile-prize-three-stage-pair'
      return `<div class="${stageClass}" style="display:flex;flex:1 1 0;min-width:0;box-sizing:border-box">${cellMarkup}</div>`
    }).join('')
    return `<div class="mini-preview-mobile-prize-three-stage-row${isTotal ? ' mini-preview-mobile-prize-three-stage-total-row' : ''}" style="display:flex;width:100%;box-sizing:border-box">${stages}</div>`
  }).join('')
  return `<div class="mini-preview-mobile-prize mini-preview-mobile-prize-three-stage" style="${wrapperStyle}">${title}${headRow}${rowsMarkup}</div>`
}

function convertGroupedPrizeTables(value) {
  const source = String(value || '')
  return source.replace(/<table\b[^>]*>[\s\S]*?<\/table\s*>/gi, (tableHtml, offset, fullSource) => {
    if (/mini-preview-mobile-prize/i.test(tableHtml)) return tableHtml
    const rows = [...tableHtml.matchAll(rowPattern)]
    if (!rows.length) return tableHtml
    const headMatch = tableHtml.match(/<thead\b[^>]*>[\s\S]*?<tr\b[^>]*>([\s\S]*?)<\/tr\s*>[\s\S]*?<\/thead\s*>/i)
    const headerInner = headMatch ? headMatch[1] : rows[0][0]
    const headerCells = [...headerInner.matchAll(cellPattern)]
    if (headerCells.length < 3) return tableHtml
    const bodyMatch = tableHtml.match(/<tbody\b[^>]*>([\s\S]*?)<\/tbody\s*>/i)
    const bodyRows = bodyMatch ? [...bodyMatch[1].matchAll(rowPattern)] : rows.slice(1)
    if (!bodyRows.length) return tableHtml
    const bodyWidths = bodyRows.map(row => [...row[0].matchAll(cellPattern)].reduce((sum, cell) => sum + cellSpan(cell[2]), 0))
    const bodyWidth = Math.max(0, ...bodyWidths)
    const effectiveHeaderWidth = headerCells.reduce((sum, cell) => sum + cellSpan(cell[2]), 0)
    const labels = headerCells.map(cell => textOf(cell[3])).join(' ')
    const compactGroupRows = bodyWidth === headerCells.length && bodyRows.some(row => [...row[0].matchAll(cellPattern)].some(cell => /[：:]/.test(textOf(cell[3]))))
    const looksGrouped = (bodyWidth >= Math.max(headerCells.length * 2, effectiveHeaderWidth) || compactGroupRows) && /(?:奖金|名次|排位|预赛|决赛|公开[A-ZＡ-Ｚ]|组名|组)/i.test(labels)
    if (!looksGrouped) return tableHtml

    const hasSpannedHeaders = headerCells.some(cell => cellSpan(cell[2]) > 1)
    const pairHeaders = headerCells.length >= 4 && headerCells.length % 2 === 0 && !hasSpannedHeaders && effectiveHeaderWidth === bodyWidth
      ? headerCells.filter((_, index) => index % 2 === 0)
      : headerCells
    const groupCount = pairHeaders.length
    const compactRows = bodyWidth === groupCount
    if (groupCount < 3 || bodyWidth < groupCount || (!compactRows && bodyWidth < groupCount * 2)) return tableHtml

    const captionMatch = tableHtml.match(/<caption\b([^>]*)>([\s\S]*?)<\/caption\s*>/i)
    const previousTableEnd = String(fullSource).toLowerCase().lastIndexOf('</table', offset)
    const nearbyMarkup = String(fullSource).slice(Math.max(previousTableEnd < 0 ? 0 : previousTableEnd + 8, offset - 1200), offset)
    const explicitTitle = [...nearbyMarkup.matchAll(/<(div|span)\b([^>]*)>([\s\S]*?)<\/\1\s*>/gi)]
      .reverse()
      .find(match => /(?:^|\s)mini-preview-prize-title(?:\s|$)/i.test((match[2].match(/\bclass\s*=\s*["']([^"']*)["']/i) || [])[1] || ''))
    const headingTitle = [...nearbyMarkup.matchAll(/<(h[1-6]|p)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi)]
      .reverse()
      .find(match => /(?:专业组|公开(?:\s*[A-DＡ-Ｄ])?组|UTV组|新秀组|女子组).*(?:奖金|设置)|(?:奖金|设置).*(?:专业组|公开|UTV|新秀|女子)/i.test(textOf(match[2])))
    const adjacentTitle = explicitTitle ? textOf(explicitTitle[3]) : headingTitle ? textOf(headingTitle[2]) : ''
    if (groupCount === 3 && pairHeaders.every(cell => cellSpan(cell[2]) === 2)) {
      return convertThreeStagePrizeTable(pairHeaders, bodyRows, captionMatch, adjacentTitle)
    }

    const title = captionMatch ? `<div class="mini-preview-mobile-prize-title" style="display:block;width:100%;box-sizing:border-box;padding:10px 8px;text-align:center;font-weight:700;line-height:1.4;overflow-wrap:anywhere">${captionMatch[2]}</div>` : ''
    if (groupCount === 4) {
      const tableTitle = captionMatch ? textOf(captionMatch[2]) : adjacentTitle
      const palette = prizeThemePalette(prizeThemeForTitle(tableTitle))
      const headerMarkup = `<div style="display:flex;width:100%;box-sizing:border-box;background-color:${palette.headerColor};color:${palette.textColor};font-weight:700">${pairHeaders.map((header, groupIndex) => {
        const groupLabel = textOf(header[3]) || `第${groupIndex + 1}组`
        const headerStyle = ['display:flex','flex:2 1 0','min-width:0','align-items:center','justify-content:center','box-sizing:border-box','padding:8px 1px','text-align:center','line-height:1.2','white-space:nowrap','overflow:hidden','border-right:1px solid #fff',`background-color:${palette.headerColor}`,`color:${palette.textColor}`,styleOf(header[2])].filter(Boolean).join(';')
        return `<div style="${headerStyle}">${groupLabel}</div>`
      }).join('')}</div>`
      const matrixRows = bodyRows.map((row, rowIndex) => {
        const cells = [...row[0].matchAll(cellPattern)]
        const isTotal = /mini-preview-prize-total-row/i.test(row[0]) || cells.some(cell => /^(小计|合计)/.test(textOf(cell[3])))
        const cellsMarkup = Array.from({ length: 4 }, (_, groupIndex) => {
          let selected
          if (isTotal) {
            selected = cells[groupIndex] ? [cells[groupIndex]] : []
          } else if (cells.length === groupCount) {
            const compactCell = cells[groupIndex]
            const compactText = textOf(compactCell?.[3])
            const separator = compactText.match(/[：:]/)?.[0]
            if (separator) {
              const separatorIndex = compactText.indexOf(separator)
              selected = [
                [compactCell[0], compactCell[1], compactCell[2], compactText.slice(0, separatorIndex)],
                [compactCell[0], compactCell[1], compactCell[2], compactText.slice(separatorIndex + 1).trim()]
              ]
            } else {
              selected = compactCell ? [compactCell, [compactCell[0], compactCell[1], compactCell[2], '']] : []
            }
          } else {
            selected = cells.slice(groupIndex * 2, groupIndex * 2 + 2)
          }
          if (!selected.length) return ''
          const background = isTotal ? palette.totalColor : (rowIndex % 2 ? palette.stripeColor : palette.bodyColor)
          const cellMarkup = selected.map(cell => {
            const cellStyle = styleOf(cell[2])
            const cellFlex = isTotal ? 'flex:2 1 0' : 'flex:1 1 0'
            const contentStyle = ['display:flex',cellFlex,'min-width:0','align-items:center','justify-content:center','box-sizing:border-box','padding:8px 1px','text-align:center','font-size:11px','line-height:1.2','white-space:nowrap','overflow:hidden','border-right:1px solid #fff',`background-color:${background}`,`color:${isTotal ? palette.totalTextColor : palette.textColor}`,isTotal ? 'font-weight:700' : '',cellStyle].filter(Boolean).join(';')
            return `<div style="${contentStyle}">${cell[3]}</div>`
          }).join('')
          return cellMarkup
        }).join('')
        return `<div style="display:flex;width:100%;box-sizing:border-box;border-top:1px solid #fff">${cellsMarkup}</div>`
      }).join('')
      const titleMarkup = captionMatch
        ? `<div class="mini-preview-mobile-prize-title" style="display:block;width:100%;box-sizing:border-box;padding:10px 6px;text-align:center;font-size:14px;font-weight:700;line-height:1.35;background-color:${palette.titleColor};color:${palette.totalTextColor}">${captionMatch[2]}</div>`
        : ''
      return `<div class="mini-preview-mobile-prize mini-preview-mobile-prize-matrix" style="display:block;width:100%;max-width:100%;min-width:0;box-sizing:border-box;overflow:hidden;font-size:11px;line-height:1.2;color:${palette.textColor}">${titleMarkup}${headerMarkup}${matrixRows}</div>`
    }
    const groupMarkup = pairHeaders.map((header, groupIndex) => {
      const groupLabel = textOf(header[3]) || `第${groupIndex + 1}组`
      const palette = prizeGroupPaletteForLabel(groupLabel, groupIndex)
      const groupStyle = [`background-color:${palette.titleColor}`, `color:${palette.totalTextColor}`, styleOf(header[2])].filter(Boolean).join(';')
      const rowsMarkup = bodyRows.map((row, rowIndex) => {
        const cells = [...row[0].matchAll(cellPattern)]
        const isTotal = /mini-preview-prize-total-row/i.test(row[0]) || cells.some(cell => /^(小计|合计)/.test(textOf(cell[3])))
        let selected
        if (isTotal) {
          selected = [cells[groupIndex]]
        } else if (cells.length === groupCount) {
          const compactCell = cells[groupIndex]
          const compactText = textOf(compactCell[3])
          const separator = compactText.match(/[：:]/)?.[0]
          if (separator) {
            const separatorIndex = compactText.indexOf(separator)
            selected = [
              [compactCell[0], compactCell[1], compactCell[2], compactText.slice(0, separatorIndex)],
              [compactCell[0], compactCell[1], compactCell[2], compactText.slice(separatorIndex + 1).trim()]
            ]
          } else {
            selected = [compactCell, [compactCell[0], compactCell[1], compactCell[2], '']]
          }
        } else {
          selected = cells.slice(groupIndex * 2, groupIndex * 2 + 2)
        }
        if (!selected.length) return ''
        const rowStyle = `display:flex;width:100%;box-sizing:border-box;${rowIndex ? 'border-top:1px solid #e6e6e6;' : ''}`
        const cellsMarkup = selected.map((cell, offset) => {
          const cellStyle = styleOf(cell[2])
          const rowBackground = isTotal ? palette.totalColor : (rowIndex % 2 ? palette.stripeColor : palette.bodyColor)
          const rowTextColor = isTotal ? palette.totalTextColor : palette.textColor
          const contentStyle = ['display:flex','align-items:center','justify-content:center','flex:1 1 0','min-width:0','box-sizing:border-box','padding:9px 5px','text-align:center','line-height:1.35','overflow-wrap:anywhere','word-break:break-word','border-right:1px solid #e6e6e6',`background-color:${rowBackground}`,`color:${rowTextColor}`,isTotal ? 'font-weight:700' : '',cellStyle].filter(Boolean).join(';')
          return `<div style="${contentStyle}">${cell[3]}</div>`
        }).join('')
        return `<div style="${rowStyle}">${cellsMarkup}</div>`
      }).join('')
      const headerRow = `<div style="display:flex;width:100%;box-sizing:border-box;background-color:${palette.headerColor};color:${palette.textColor};font-weight:700"><div style="flex:1 1 0;min-width:0;box-sizing:border-box;padding:9px 5px;text-align:center;line-height:1.35;overflow-wrap:anywhere;border-right:1px solid #fff">名次</div><div style="flex:1 1 0;min-width:0;box-sizing:border-box;padding:9px 5px;text-align:center;line-height:1.35;overflow-wrap:anywhere;border-right:1px solid #fff">奖金</div></div>`
      return `<div class="mini-preview-mobile-prize-group" style="width:100%;box-sizing:border-box;margin:0 0 12px;border:1px solid #d8d8d8;overflow:hidden"><div style="display:block;width:100%;box-sizing:border-box;padding:8px 6px;text-align:center;font-weight:700;line-height:1.35;overflow-wrap:anywhere;${groupStyle}">${groupLabel}</div>${headerRow}${rowsMarkup}</div>`
    }).join('')
    return `<div class="mini-preview-mobile-prize" style="display:block;width:100%;max-width:100%;min-width:0;box-sizing:border-box;overflow:hidden">${title}${groupMarkup}</div>`
  })
}

module.exports = { convertGroupedPrizeTables, normalizePrizeStageLabel, normalizePrizeTitleColors, normalizePrizeTableColors, prizeTableMobileLayout, prizeThemeForTitle, prizeThemePalette, repairPrizeTableColspans }

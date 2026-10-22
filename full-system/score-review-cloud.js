(function (root, factory) {
  const adapter = factory()
  if (typeof module === 'object' && module.exports) module.exports = adapter
  if (root) root.ScoreReviewCloud = adapter
})(typeof window !== 'undefined' ? window : globalThis, function () {
  const uiStatus = { pending: '待审核', approved: '已通过', returned: '已退回' }
  const cloudStatus = { 待审核: 'pending', 已通过: 'approved', 已退回: 'returned' }

  function canonicalCarNumber(value) {
    return String(value ?? '').replace(/[^0-9a-z]/gi, '').toUpperCase()
  }

  function parseDuration(value) {
    const match = String(value ?? '').trim().match(/^(\d+):([0-5]?\d):([0-5]?\d)(?:\.(\d{1,3}))?$/)
    return match
      ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(`0.${(match[4] || '0').padEnd(3, '0')}`)
      : null
  }

  function formatDuration(seconds) {
    const value = Number(seconds)
    if (!Number.isFinite(value) || value < 0) return ''
    const ms = Math.round(value * 1000)
    const hours = Math.floor(ms / 3600000)
    const minutes = Math.floor(ms % 3600000 / 60000)
    const wholeSeconds = Math.floor(ms % 60000 / 1000)
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(wholeSeconds).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`
  }

  function fromCloudRow(row, stage, meta = {}) {
    const storedTime = row && (row.segmentDuration || row.duration || row.totalDuration)
    const parsedTime = parseDuration(storedTime)
    const numericTime = Number(row && row.time)
    const rawPenalty = row && (row.penaltyTotal ?? row.penalty)
    const penaltyNumber = Number(rawPenalty)
    const rawStatus = String(row && row.status || 'pending').toLowerCase()
    return {
      ...(row && typeof row === 'object' ? row : {}),
      id: String(row && row.id || ''),
      number: canonicalCarNumber(row && (row.carNumber || row.car)),
      group: String(row && (row.group || row.groupName || row.teamName) || '').trim(),
      stage: String(stage || row && row.stage || 'SS1').toUpperCase(),
      startAt: String(row && (row.startTime || row.start) || ''),
      finishAt: String(row && (row.endTime || row.finish) || ''),
      time: parsedTime !== null ? parsedTime : Number.isFinite(numericTime) ? numericTime : null,
      penalty: Number.isFinite(penaltyNumber) ? penaltyNumber : String(rawPenalty ?? '0'),
      uploader: String(row && row.uploader || meta.updatedByPhone || '云端工作人员'),
      uploadedAt: String(row && row.uploadedAt || meta.updatedAt || ''),
      status: uiStatus[rawStatus] || '待审核',
      reason: String(row && (row.note || row.reason) || ''),
      durationManual: row && row.durationManual === true,
      penaltyInputs: Array.isArray(row && row.penaltyInputs) ? row.penaltyInputs : []
    }
  }

  function toCloudRow(row) {
    const number = canonicalCarNumber(row && (row.number || row.carNumber))
    const time = Number(row && row.time)
    const status = cloudStatus[String(row && row.status || '')] || 'pending'
    const penalty = row && row.penalty != null ? String(row.penalty) : '0'
    const duration = Number.isFinite(time) && time >= 0 ? formatDuration(time) : ''
    return {
      ...(row && typeof row === 'object' ? row : {}),
      id: String(row && row.id || `score-${String(row && row.stage || 'SS1').toUpperCase()}-${number}`),
      carNumber: number,
      group: String(row && row.group || '').trim(),
      teamName: String(row && row.group || '').trim(),
      driver: String(row && row.driver || ''),
      stage: String(row && row.stage || 'SS1').toUpperCase(),
      startTime: String(row && (row.startAt || row.startTime) || ''),
      endTime: String(row && (row.finishAt || row.endTime) || ''),
      penaltyInputs: Array.isArray(row && row.penaltyInputs) ? row.penaltyInputs : [],
      penaltyTotal: penalty,
      segmentDuration: duration,
      totalDuration: duration,
      durationManual: true,
      uploader: String(row && row.uploader || ''),
      uploadedAt: String(row && row.uploadedAt || ''),
      status,
      note: String(row && (row.reason || row.note) || '')
    }
  }

  async function request(fetcher, apiUrl, path, options = {}) {
    const response = await fetcher(`${String(apiUrl || '').replace(/\/$/, '')}${path}`, {
      credentials: 'include',
      headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
      ...options
    })
    let payload = null
    try { payload = await response.json() } catch {}
    if (!response.ok || !payload || payload.ok !== true) {
      const message = payload && payload.message || (response.status === 401 ? '网页后台登录已过期，请重新登录' : `云端请求失败（${response.status}）`)
      throw new Error(message)
    }
    return payload
  }

  async function checkConnection(fetcher, apiUrl) {
    const health = await request(fetcher, apiUrl, '/api/health')
    if (health.cloudEnabled !== true || health.cloudDatabaseConnected !== true) {
      throw new Error(`赛事云端数据库未连接（${health.cloudDatabaseDiagnostic || '未知状态'}）`)
    }
    await request(fetcher, apiUrl, '/api/session')
  }

  async function loadRows({ fetcher, apiUrl, eventId }) {
    const id = String(eventId || '').trim()
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) throw new Error('当前赛事 ID 无效，已停止读取云端成绩')
    await checkConnection(fetcher, apiUrl)
    const stages = Array.from({ length: 20 }, (_, index) => `SS${index + 1}`)
    const responses = []
    for (let offset = 0; offset < stages.length; offset += 4) {
      const batch = await Promise.all(stages.slice(offset, offset + 4).map(async stage => {
        try {
          return await request(fetcher, apiUrl, `/api/work-records?eventId=${encodeURIComponent(id)}&stage=${stage}`)
        } catch (error) {
          throw new Error(`${stage}：${error.message || error}`)
        }
      }))
      responses.push(...batch)
    }

    const rows = []
    const revisions = {}
    responses.forEach((payload, index) => {
      const stage = stages[index]
      if (!Array.isArray(payload.rows)) throw new Error(`${stage} 成绩接口返回格式无效`)
      const revision = Number(payload.revision)
      if (payload.revision == null || payload.revision === '' || !Number.isSafeInteger(revision) || revision < 0) throw new Error(`${stage} 云端版本号无效，已停止刷新`)
      if (payload.count != null && Number(payload.count) !== payload.rows.length) throw new Error(`${stage} 只读取到 ${payload.rows.length}/${payload.count} 条`)
      if (payload.rows.length > 1000) throw new Error(`${stage} 云端超过 1000 条，已停止刷新以避免显示不完整`)
      revisions[stage] = revision
      const seen = new Set()
      payload.rows.forEach((row, rowIndex) => {
        const normalized = fromCloudRow(row, stage, payload)
        if (!normalized.number) throw new Error(`${stage} 第 ${rowIndex + 1} 条云端成绩缺少车号，已停止读取以避免漏数据`)
        if (seen.has(normalized.number)) throw new Error(`${stage} 车号 ${normalized.number} 重复，已停止读取以避免成绩错配`)
        seen.add(normalized.number)
        rows.push(normalized)
      })
    })
    return { rows, revisions }
  }

  async function saveStage({ fetcher, apiUrl, eventId, stage, rows, expectedRevision }) {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new Error(`${stage} 云端版本号无效，请刷新后重试`)
    if (!Array.isArray(rows) || rows.length > 1000) throw new Error(`${stage} 每个赛段最多保存 1000 条成绩`)
    const payload = await request(fetcher, apiUrl, '/api/work-records', {
      method: 'PUT',
      body: JSON.stringify({ eventId, stage, rows: rows.map(toCloudRow), expectedRevision })
    })
    if (Number(payload.count) !== rows.length) throw new Error(`${stage} 云端只确认保存 ${payload.count || 0}/${rows.length} 条`)
    const revision = Number(payload.revision)
    if (!Number.isSafeInteger(revision) || revision !== expectedRevision + 1) throw new Error(`${stage} 云端未返回连续版本号，请刷新后核对`)
    return revision
  }

  async function publish({ fetcher, apiUrl, eventId, visibleGroups, groupStageNames }) {
    return request(fetcher, apiUrl, '/api/published-results', {
      method: 'POST',
      body: JSON.stringify({ eventId, visibleGroups, groupStageNames, rankingMode: 'total' })
    })
  }

  return { canonicalCarNumber, parseDuration, formatDuration, fromCloudRow, toCloudRow, checkConnection, loadRows, saveStage, publish }
})

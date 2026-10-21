const auth = require('../../utils/auth')
const config = require('../../config/cloud')
const container = require('../../utils/cloud-container')

const { ALL_STAGES: SUPPORTED_STAGES } = require('../../utils/stages')

function normalizeEventId(value) {
  const id = String(value == null ? '' : value).trim()
  return /^[A-Za-z0-9_-]{1,80}$/.test(id) ? id : ''
}

function readEventList(response) {
  let payload = response && response.data
  if (typeof payload === 'string') {
    try { payload = JSON.parse(payload) } catch (_) { throw new Error('赛事列表响应不是有效 JSON') }
  }
  if (!payload || payload.ok !== true || !Array.isArray(payload.events)) throw new Error('无法验证当前赛事配置')
  return payload.events
}

function isTransientNetworkError(error) {
  const code = String(error && (error.errCode || error.code) || '').toUpperCase()
  if (['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ENETUNREACH', 'EHOSTUNREACH', 'EAI_AGAIN'].includes(code)) return true
  const message = String(error && (error.errMsg || error.message) || '').toLowerCase()
  return /timed? ?out|timeout|network|socket|econnreset|econnrefused|enetunreach|ehostunreach|eai_again|connection reset|connection refused|request:fail/.test(message)
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

Page({
  data: {
    allowed: false,
    checking: true,
    eventId: '',
    eventScopeReady: false,
    stages: [],
    selectedStage: 'SS1',
    entryPermissions: { startTime: true, endTime: true, penalty: true },
    canEditStartTime: true,
    canEditEndTime: true,
    canEditPenalty: true,
    cloudReady: false,
    cloudSyncing: false,
    uploading: false,
    cloudSyncMessage: '等待云端连接',
    cloudSyncRetryVisible: false,
    keyboardMode: 'number',
    inputFocusKey: '',
    focusedPenaltyIndex: -1,
    startCursor: 0,
    endCursor: 0,
    penaltyCursors: [0],
    carInput: '',
    canAddRecord: false,
    carRows: [],
    filteredCount: 0,
    visibleCarRows: [],
    rosterViewportHeight: 82,
    rosterQuery: '',
    rosterFocusId: '',
    rosterScrollTop: 0,
    rosterTopSpacer: 0,
    rosterBottomSpacer: 0,
    currentCarId: '',
    currentCarNumber: '',
    startTime: '',
    endTime: '',
    penaltyInputs: [{ id: 'initial_penalty', value: '' }],
    maxPenaltyInputs: 10,
    maxCarRows: 1000,
    penaltyTotal: '0',
    segmentDuration: '待输入',
    totalDuration: '待输入'
  },

  onLoad(query) {
    this._pageUnloaded = false
    const eventId = normalizeEventId(query && query.eventId)
    if (!eventId) {
      this.setData({ eventId: '', allowed: false, checking: false, cloudSyncMessage: '缺少有效赛事标识，无法进入工作后台' })
      return
    }
    // Read local results only after both event and account checks pass.
    this.setData({ eventId })
  },

  selectStage(e) {
    const stage = e && e.currentTarget && e.currentTarget.dataset.stage
    if (!this.data.allowed || !this.data.eventScopeReady || !this.data.stages.includes(stage) || stage === this.data.selectedStage) return
    if (!this.flushRows()) {
      wx.showModal({ title: '切换已停止', content: '当前赛段成绩快照未能保存到本机。请检查设备存储后重试，避免丢失刚才的修改。', showCancel: false })
      return
    }
    // Invalidate any in-flight response for the previous stage immediately.
    this._cloudReadRequestId = (this._cloudReadRequestId || 0) + 1
    this.clearActiveRecord()
    this.setData({ selectedStage: stage, carRows: [], carInput: '' }, () => {
      this.loadCarRows(stage)
      this.syncCloudRows(stage)
    })
  },

  onUnload() {
    this.flushRows()
    this._pageUnloaded = true
    clearTimeout(this._cloudRetryTimer)
    this._cloudRetryTimer = null
  },

  onShow() {
    const eventId = normalizeEventId(this.data.eventId)
    if (!eventId) {
      this.setData({ allowed: false, checking: false, cloudSyncMessage: '缺少有效赛事标识，无法读取或保存成绩' })
      return
    }
    this._pageUnloaded = false
    const requestId = (this._accessRequestId || 0) + 1
    this._accessRequestId = requestId
    this.setData({ allowed: false, checking: true, eventScopeReady: false })
    Promise.all([auth.refreshRole(), this.loadEventScope(eventId)]).then(([user, eventScope]) => {
      if (this._pageUnloaded || this._accessRequestId !== requestId || normalizeEventId(this.data.eventId) !== eventId) return
      const allowed = !!(user && (user.isStaff || user.isAdmin))
      const accountStages = user && user.isAdmin
        ? eventScope.stages
        : (Array.isArray(user && user.stagePermissions) ? user.stagePermissions.filter(stage => SUPPORTED_STAGES.includes(stage)) : [])
      // Staff permissions are global today; intersect them with this event's
      // enabled stages so the page never exposes an unconfigured SS tab.
      const stages = eventScope.stages.filter(stage => accountStages.includes(stage))
      const availableStages = stages
      const hasStageAccess = !!(user && user.isAdmin) || availableStages.length > 0
      const nextStage = availableStages.includes(this.data.selectedStage) ? this.data.selectedStage : (availableStages[0] || '')
      const stageChanged = nextStage !== this.data.selectedStage
      if (stageChanged && nextStage && !this.flushRows()) {
        this.setData({ allowed: false, checking: false })
        wx.showModal({ title: '赛段切换已停止', content: '当前赛段成绩快照未能保存到本机。为避免丢失修改，页面已停止录入；请检查设备存储后重新进入。', showCancel: false })
        return
      }
      this.setData({
        allowed: allowed && hasStageAccess,
        eventScopeReady: true,
        eventTitle: eventScope.title,
        stages: availableStages,
        selectedStage: nextStage,
        checking: false,
        isAdmin: !!(user && user.isAdmin),
        isSuperAdmin: !!(user && user.isSuperAdmin),
        entryPermissions: user && user.isAdmin
          ? { startTime: true, endTime: true, penalty: true }
          : this.normalizeEntryPermissions(user && user.entryPermissions),
        canEditStartTime: !!(user && (user.isAdmin || !user.entryPermissions || user.entryPermissions.startTime !== false)),
        canEditEndTime: !!(user && (user.isAdmin || !user.entryPermissions || user.entryPermissions.endTime !== false)),
        canEditPenalty: !!(user && (user.isAdmin || !user.entryPermissions || user.entryPermissions.penalty !== false))
      }, () => {
        if (stageChanged && nextStage) {
          this.clearActiveRecord()
          this.setData({ carRows: [], carInput: '' }, () => {
            this.loadCarRows(nextStage)
            this.syncCloudRows(nextStage)
          })
        } else {
          const stage = nextStage || this.data.selectedStage
          if (allowed && hasStageAccess && !this._initialRowsLoaded) this.loadCarRows(stage)
          this.syncCloudRows(stage)
        }
      })
      if (!allowed) wx.showToast({ title: '无工作权限', icon: 'none' })
    }).catch(error => {
      if (this._pageUnloaded || this._accessRequestId !== requestId || normalizeEventId(this.data.eventId) !== eventId) return
      this.setData({ allowed: false, checking: false, eventScopeReady: false, cloudReady: false, cloudSyncMessage: '无法确认赛事或工作权限，已停止成绩读写' })
      wx.showToast({ title: error.message || '赛事或权限校验失败', icon: 'none' })
    })
  },

  loadEventScope(eventId) {
    const scopedId = normalizeEventId(eventId)
    if (!scopedId) return Promise.reject(new Error('缺少有效赛事标识'))
    return container.call('/api/public/events').then(readEventList).then(events => {
      const records = events.filter(item => String(item && (item.id || item._id) || '') === scopedId)
      if (records.length > 1) throw new Error('当前赛事配置重复，已停止成绩读写')
      const record = records[0]
      if (!record) throw new Error('云端尚未发布当前赛事')
      if (record.workBackendEnabled === false) throw new Error('本赛事未开放工作后台')
      if (!Array.isArray(record.stageNames) || record.stageNames.length === 0) throw new Error('本赛事未配置可录入赛段')
      const stages = record.stageNames.map(stage => String(stage || '').trim().toUpperCase())
      if (stages.some(stage => !SUPPORTED_STAGES.includes(stage)) || new Set(stages).size !== stages.length) {
        throw new Error('本赛事赛段配置无效')
      }
      return { id: scopedId, title: String(record.title || ''), stages }
    })
  },

  storageKey(stage) {
    const eventId = normalizeEventId(this.data.eventId)
    if (!eventId) throw new Error('缺少有效赛事标识，禁止读取本地成绩缓存')
    const stageName = String(stage || this.data.selectedStage || '').toUpperCase()
    if (!SUPPORTED_STAGES.includes(stageName)) throw new Error('赛段标识无效，禁止读取本地成绩缓存')
    return 'racing_shared_' + stageName.toLowerCase() + '_' + eventId
  },

  legacyStorageKey(stage) {
    const eventId = normalizeEventId(this.data.eventId)
    if (!eventId) throw new Error('缺少有效赛事标识，禁止读取旧成绩缓存')
    const stageName = String(stage || this.data.selectedStage || '').toUpperCase()
    if (!SUPPORTED_STAGES.includes(stageName)) throw new Error('赛段标识无效，禁止读取旧成绩缓存')
    return 'racing_admin_' + stageName.toLowerCase() + '_' + eventId
  },

  dirtyStorageKey(stage) {
    return this.storageKey(stage) + '_dirty'
  },

  pendingStorageKey(stage) {
    return this.storageKey(stage) + '_pending'
  },

  revisionStorageKey(stage) {
    return this.storageKey(stage) + '_revision'
  },

  quarantineStorageValue(key, value) {
    const sourceKey = String(key || '')
    if (!sourceKey) return false
    const backupKey = `${sourceKey}_corrupt_${Date.now()}`
    try {
      wx.setStorageSync(backupKey, {
        quarantinedAt: new Date().toISOString(),
        sourceKey,
        value
      })
    } catch (error) {
      return false
    }
    try {
      wx.removeStorageSync(sourceKey)
      return true
    } catch (error) {
      return false
    }
  },

  getStageRevision(stage) {
    if (!this._stageRevisions) this._stageRevisions = {}
    if (Number.isSafeInteger(this._stageRevisions[stage]) && this._stageRevisions[stage] >= 0) return this._stageRevisions[stage]
    try {
      const stored = wx.getStorageSync(this.revisionStorageKey(stage))
      if (Number.isSafeInteger(stored) && stored >= 0) {
        this._stageRevisions[stage] = stored
        return stored
      }
    } catch (error) {}
    return null
  },

  setStageRevision(stage, revision) {
    if (!Number.isSafeInteger(revision) || revision < 0) throw new Error(`${stage} 云端版本号无效`)
    if (!this._stageRevisions) this._stageRevisions = {}
    wx.setStorageSync(this.revisionStorageKey(stage), revision)
    this._stageRevisions[stage] = revision
  },

  callWorkCloud(action, data) {
    const eventId = normalizeEventId(this.data.eventId)
    if (!eventId) return Promise.reject(new Error('缺少有效赛事标识，已停止成绩读写'))
    if (!this.data.allowed || !this.data.eventScopeReady) return Promise.reject(new Error('未通过赛事或工作权限校验'))
    auth.init()
    if (!wx.cloud) return Promise.reject(new Error('云开发未初始化'))
    const payload = Object.assign({ stage: this.data.selectedStage }, data || {})
    if (payload.eventId != null && normalizeEventId(payload.eventId) !== eventId) {
      return Promise.reject(new Error('赛事标识不一致，已停止本次成绩操作'))
    }
    payload.action = action
    // Force the event scope after caller data, preventing a mismatched batch
    // payload from crossing into another event.
    payload.eventId = eventId
    if (!this.data.stages.includes(payload.stage)
      || (Array.isArray(payload.records) && payload.records.some(record => !record || !this.data.stages.includes(record.stage)))) {
      return Promise.reject(new Error('当前账号没有本赛事该赛段的工作权限'))
    }
    const invoke = attempt => wx.cloud.callFunction({
      name: config.accountFunction,
      data: payload
    }).catch(error => {
      if (action !== 'getWorkRecords' || attempt >= 2 || !isTransientNetworkError(error)) throw error
      return wait(250 * (2 ** attempt)).then(() => invoke(attempt + 1))
    })
    return invoke(0).then(response => {
      const result = response && response.result
      if (!result || !result.ok) {
        const error = new Error(result && result.message || '成绩服务暂时不可用')
        if (result && result.code) error.code = result.code
        throw error
      }
      if (result.eventId != null && normalizeEventId(result.eventId) !== eventId) throw new Error('云端响应赛事标识不一致，已拒绝应用成绩')
      if (result.stage != null && String(result.stage) !== String(payload.stage)) throw new Error('云端响应赛段不一致，已拒绝应用成绩')
      return result
    })
  },

  syncCloudRows(stage) {
    if (!normalizeEventId(this.data.eventId) || !this.data.allowed || !this.data.eventScopeReady || !stage || !this.data.stages.includes(stage) || stage !== this.data.selectedStage) return
    const requestId = (this._cloudReadRequestId || 0) + 1
    this._cloudReadRequestId = requestId
    const eventId = normalizeEventId(this.data.eventId)
    const cachedRevision = this.getStageRevision(stage)
    this.setData({ cloudSyncing: true, cloudSyncMessage: '正在读取云端成绩', cloudSyncRetryVisible: false })
    this.callWorkCloud('getWorkRecords', { stage }).then(result => {
      if (!this.isCurrentCloudRead(requestId, eventId, stage)) return
      if (!Array.isArray(result.rows)) throw new Error(`${stage} 云端成绩格式无效，未覆盖本地数据`)
      const remoteRows = result.rows
      if (!Number.isSafeInteger(result.revision) || result.revision < 0) throw new Error(`${stage} 云端版本号无效，未覆盖本地数据`)
      const remoteRevision = result.revision
      if (result.count != null && Number(result.count) !== remoteRows.length) throw new Error(`${stage} 云端返回 ${remoteRows.length}/${result.count} 条，未覆盖本地数据`)
      if (remoteRows.length > this.data.maxCarRows) {
        this.setData({ cloudReady: false, cloudSyncing: false, cloudSyncMessage: `${stage} 云端有 ${remoteRows.length} 条，超过单赛段上限 ${this.data.maxCarRows}；未覆盖本地数据，请联系管理员处理`, cloudSyncRetryVisible: true })
        return
      }
      const remoteIssue = this.validateRowsForTransfer(remoteRows)
      if (remoteIssue) throw new Error(`${stage} 云端成绩校验失败：${remoteIssue}；未覆盖本地数据`)
      this.setStageRevision(stage, remoteRevision)
      // 用户可能在云端读取完成前已经录入数据；优先使用这份待上传数据，
      // 避免迟到的云端空结果覆盖当前编辑内容。
      if (this._pendingRows && this._pendingRowsStage === stage && this._pendingRowsEventId === eventId) {
        if (!this.flushRows()) throw new Error(`${stage} 本地修改快照保存失败，已停止云端覆盖`)
      }
      let pending = this._pendingCloudRows
      if (!pending || pending.stage !== stage || pending.eventId !== normalizeEventId(this.data.eventId)) {
        try {
          const durable = wx.getStorageSync(this.pendingStorageKey(stage))
          if (durable && durable.eventId === normalizeEventId(this.data.eventId) && Array.isArray(durable.rows)) {
            pending = { rows: durable.rows, stage, eventId: durable.eventId, expectedRevision: durable.expectedRevision }
            this._pendingCloudRows = pending
          }
        } catch (error) {
          throw new Error(`待同步成绩缓存读取失败：${error.message || '存储不可用'}，已停止云端覆盖`)
        }
      }
      if (pending && pending.stage === stage && pending.eventId === normalizeEventId(this.data.eventId)) {
        if (!Number.isSafeInteger(pending.expectedRevision) || pending.expectedRevision < 0) {
          if (remoteRevision !== 0) {
            this.markRevisionConflict(stage, null, `${stage} 本地待同步快照缺少版本号，云端已有版本 ${remoteRevision}；本地修改已保留，为避免覆盖云端数据已停止上传，请先刷新核对`)
            this.setData({ cloudReady: true, cloudSyncing: false, cloudSyncRetryVisible: false }, () => {
              if (this.isCurrentCloudRead(requestId, eventId, stage)) this.applyRowsFromCloud(pending.rows, stage)
            })
            return
          }
          pending.expectedRevision = 0
          try { wx.setStorageSync(this.pendingStorageKey(stage), pending) } catch (error) {
            throw new Error(`${stage} 待同步快照版本号保存失败：${error.message || '本机存储不可用'}，已停止上传`)
          }
        }
        if (pending.expectedRevision !== remoteRevision) {
          this.markRevisionConflict(stage, pending.expectedRevision, `${stage} 本地版本 ${pending.expectedRevision} 与云端版本 ${remoteRevision} 不一致；本地修改已保留，未覆盖云端数据，请刷新核对后再编辑`)
          this.setData({ cloudReady: true, cloudSyncing: false, cloudSyncRetryVisible: false }, () => {
            if (this.isCurrentCloudRead(requestId, eventId, stage)) this.applyRowsFromCloud(pending.rows, stage)
          })
          return
        }
        this.clearRevisionConflict(stage)
        this.setData({ cloudReady: true, cloudSyncing: false, cloudSyncMessage: '本地修改待同步', cloudSyncRetryVisible: false }, () => {
          if (!this.isCurrentCloudRead(requestId, eventId, stage)) return
          if (this.applyRowsFromCloud(pending.rows, stage)) this.flushPendingCloud()
        })
        return
      }
      let localRows = []
      let hasScopedStorage = false
      let hasLegacyStorage = false
      let localDirty = false
      try {
        const scopedKey = this.storageKey(stage)
        const legacyKey = this.legacyStorageKey(stage)
        const storageInfo = wx.getStorageInfoSync()
        hasScopedStorage = Array.isArray(storageInfo.keys) && storageInfo.keys.includes(scopedKey)
        hasLegacyStorage = Array.isArray(storageInfo.keys) && storageInfo.keys.includes(legacyKey)
        localDirty = wx.getStorageSync(this.dirtyStorageKey(stage)) === true
        const stored = wx.getStorageSync(scopedKey)
        if (stored != null && !Array.isArray(stored)) {
          // Older builds or another writer may have left a non-list value in
          // the scoped key. Preserve it before discarding so it cannot block
          // a valid cloud row from being displayed. Never clear dirty data.
          if (localDirty || !this.quarantineStorageValue(scopedKey, stored)) throw new Error('缓存不是成绩列表格式')
          hasScopedStorage = false
        } else if (Array.isArray(stored)) localRows = stored
        // 只在当前账号还没有建立过新缓存时迁移旧缓存。当前缓存明确为空时，
        // 空数组代表用户已清空成绩，不能再被旧缓存复活。
        if (!hasScopedStorage) {
          const legacyKey = this.legacyStorageKey(stage)
          const legacy = wx.getStorageSync(legacyKey)
          if (legacy != null && !Array.isArray(legacy)) {
            if (localDirty || !this.quarantineStorageValue(legacyKey, legacy)) throw new Error('旧版缓存不是成绩列表格式')
          } else if (Array.isArray(legacy)) {
            localRows = legacy
            wx.setStorageSync(scopedKey, legacy)
            wx.removeStorageSync(legacyKey)
          }
        }
      } catch (error) {
        throw new Error(`本地成绩缓存读取失败：${error.message || '存储不可用'}，已停止云端覆盖`)
      }
      // 本地有未确认上传的改动时，以本地快照为准。这样删除成绩后即使
      // 立即退出或网络中断，重新进入也不会被旧云端数据覆盖。
      if ((localDirty && hasScopedStorage) || !remoteRows.length) {
        const localIssue = this.validateRowsForTransfer(localRows)
        if (localIssue) {
          this.setData({ cloudReady: false, cloudSyncing: false, cloudSyncMessage: `本地成绩未同步：${localIssue}。为避免覆盖云端数据，已停止自动同步`, cloudSyncRetryVisible: true })
          return
        }
      }
      if (localDirty && hasScopedStorage) {
        if (this._revisionConflictStages && this._revisionConflictStages[stage]) {
          this.setData({ cloudReady: true, cloudSyncing: false, cloudSyncMessage: `${stage} 存在云端版本冲突；本地修改已保留，未自动覆盖，请联系管理员核对后再处理`, cloudSyncRetryVisible: false }, () => {
            if (this.isCurrentCloudRead(requestId, eventId, stage)) this.setData({ carRows: localRows.map((row, index) => this.normalizeRecord(row, index)) }, () => this.refreshRosterWindow({ scrollTop: 0 }))
          })
          return
        }
        if ((cachedRevision === null && remoteRevision > 0) || (cachedRevision !== null && cachedRevision !== remoteRevision)) {
          this.markRevisionConflict(stage, cachedRevision, `${stage} 本地修改对应版本 ${cachedRevision == null ? '未知' : cachedRevision}，云端版本为 ${remoteRevision}；本地修改已保留，未覆盖云端数据，请刷新核对`)
          this.setData({ cloudReady: true, cloudSyncing: false, cloudSyncRetryVisible: false }, () => {
            if (this.isCurrentCloudRead(requestId, eventId, stage)) this.setData({ carRows: localRows.map((row, index) => this.normalizeRecord(row, index)) }, () => this.refreshRosterWindow({ scrollTop: 0 }))
          })
          return
        }
        const normalized = localRows.map((row, index) => this.normalizeRecord(row, index))
        this.setData({ cloudReady: true, cloudSyncing: false, cloudSyncMessage: '云端成绩已读取', cloudSyncRetryVisible: false }, () => {
          if (!this.isCurrentCloudRead(requestId, eventId, stage)) return
          this.applyRowsFromCloud(normalized, stage)
          this.saveRows(normalized, stage)
        })
        return
      }
      // 云端是主数据；首次迁移时把当前账号已有的本地记录上传一次。
      if (remoteRows.length || !localRows.length || remoteRevision > 0) {
        this.setData({ cloudReady: true, cloudSyncing: false, cloudSyncMessage: '云端成绩已读取', cloudSyncRetryVisible: false }, () => {
          if (!this.isCurrentCloudRead(requestId, eventId, stage)) return
          this.applyRowsFromCloud(remoteRows, stage)
        })
      } else {
        const normalized = localRows.map((row, index) => this.normalizeRecord(row, index))
        this.setData({ cloudReady: true, cloudSyncing: false, cloudSyncMessage: '本地成绩待上传', cloudSyncRetryVisible: false }, () => {
          if (!this.isCurrentCloudRead(requestId, eventId, stage)) return
          this.setData({ carRows: normalized }, () => this.refreshRosterWindow())
          this.saveRows(normalized, stage)
        })
      }
      this.flushPendingCloud()
    }).catch(error => {
      if (!this.isCurrentCloudRead(requestId, eventId, stage)) return
      console.warn('读取云端成绩失败', error)
      this.setData({ cloudReady: false, cloudSyncing: false, cloudSyncMessage: `云端读取失败：${error.message||'请检查网络后重试'}`, cloudSyncRetryVisible: true })
    })
  },

  isCurrentCloudRead(requestId, eventId, stage) {
    return !this._pageUnloaded
      && this._cloudReadRequestId === requestId
      && normalizeEventId(this.data.eventId) === eventId
      && this.data.selectedStage === stage
  },

  markRevisionConflict(stage, expectedRevision, message) {
    this._revisionConflictStages = this._revisionConflictStages || {}
    this._revisionConflictExpected = this._revisionConflictExpected || {}
    this._revisionConflictStages[stage] = true
    this._revisionConflictExpected[stage] = Number.isSafeInteger(expectedRevision) && expectedRevision >= 0 ? expectedRevision : null
    if (stage === this.data.selectedStage) this.setData({ cloudSyncMessage: message, cloudSyncRetryVisible: false })
  },

  clearRevisionConflict(stage) {
    if (this._revisionConflictStages) delete this._revisionConflictStages[stage]
    if (this._revisionConflictExpected) delete this._revisionConflictExpected[stage]
  },

  applyRowsFromCloud(rows, stage) {
    if (!Array.isArray(rows)) {
      this.setData({ cloudReady: false, cloudSyncMessage: `${stage} 云端成绩格式无效，未覆盖本地数据`, cloudSyncRetryVisible: true })
      return false
    }
    const source = rows
    const issue = this.validateRowsForTransfer(source)
    if (issue) {
      this.setData({ cloudReady: false, cloudSyncMessage: `${stage} 成绩未完整载入：${issue}`, cloudSyncRetryVisible: true })
      return false
    }
    const normalized = source.map((row, index) => this.normalizeRecord(row, index))
    this.setData({ carRows: normalized, carInput: '', rosterQuery: '', rosterScrollTop: 0, rosterFocusId: '' }, () => {
      this.refreshRosterWindow({ scrollTop: 0 })
      if (normalized.length) this.activateRecord(normalized[0])
      else this.clearActiveRecord()
    })
    return true
  },

  loadCarRows(stage) {
    if (!normalizeEventId(this.data.eventId) || !this.data.allowed || !this.data.eventScopeReady) return
    let rows = []
    let readError = null
    let hasScopedStorage = false
    let hasLegacyStorage = false
    try {
      const key = this.storageKey(stage)
      const legacyKey = this.legacyStorageKey(stage)
      const info = wx.getStorageInfoSync()
      hasScopedStorage = Array.isArray(info.keys) && info.keys.includes(key)
      hasLegacyStorage = Array.isArray(info.keys) && info.keys.includes(legacyKey)
      const stored = wx.getStorageSync(key)
      if (stored != null && !Array.isArray(stored)) {
        const dirty = wx.getStorageSync(this.dirtyStorageKey(stage)) === true
        if (dirty || !this.quarantineStorageValue(key, stored)) throw new Error('缓存不是成绩列表格式')
        hasScopedStorage = false
      } else if (Array.isArray(stored)) rows = stored
    } catch (error) {
      readError = error
    }
    const issue = this.validateRowsForTransfer(rows)
    if (readError || issue) {
      const message = readError
        ? `本地成绩缓存读取失败：${readError.message || '存储不可用'}，未加载或覆盖成绩`
        : `本地成绩尚未同步：${issue}；修正后再试`
      this.setData({ carRows: [], cloudReady: false, cloudSyncMessage: message, cloudSyncRetryVisible: true })
      return
    }
    rows = rows.map((row, index) => this.normalizeRecord(row, index))
    const displayRows = rows
    this.setData({ carRows: displayRows, carInput: '', rosterQuery: '', rosterScrollTop: 0, rosterFocusId: '' }, () => {
      this._initialRowsLoaded = true
      this.refreshRosterWindow({ scrollTop: 0 })
      if (displayRows.length) this.activateRecord(displayRows[0])
      else this.clearActiveRecord()
    })
  },

  getRosterFilteredRows(query) {
    const normalized = this.sanitizeCarNumber(query === undefined ? this.data.rosterQuery : query)
    if (!normalized) return this.data.carRows
    return this.data.carRows.filter(row => String(row.carNumber || '').includes(normalized))
  },

  refreshRosterWindow(options) {
    const settings = options || {}
    const filtered = this.getRosterFilteredRows(settings.query)
    const displayRows = filtered.map(row => ({
      ...row,
      displayStartTime: this.formatDisplayClock(row.startTime),
      displayEndTime: this.formatDisplayEndClock(row.endTime),
      displaySegmentDuration: row.segmentDuration && row.segmentDuration !== '待输入'
        ? row.segmentDuration
        : this.calculateResult(row.startTime, row.endTime, row.penaltyInputs).segmentDuration
    }))
    const nextData = {
      filteredCount: filtered.length,
      visibleCarRows: displayRows,
      rosterViewportHeight: Math.max(82, Math.min(filtered.length, 6) * 82),
      rosterTopSpacer: 0,
      rosterBottomSpacer: 0
    }
    if (settings.resetScroll || typeof settings.targetIndex === 'number' || settings.scrollTop === 0) {
      nextData.rosterScrollTop = typeof settings.targetIndex === 'number'
        ? Math.max(0, Number(settings.targetIndex) * 82)
        : 0
    }
    const visibleSignature = filtered.map(row => [row.id, row.carNumber, row.startTime, row.endTime, row.penaltyTotal, row.segmentDuration, row.swiped].join(':')).join('|')
    const windowKey = [this.data.rosterQuery || '', filtered.length, visibleSignature].join('|')
    if (windowKey === this._rosterWindowKey) return
    this._rosterWindowKey = windowKey
    this.setData(nextData)
  },

  onRosterSearchInput(e) {
    const rosterQuery = this.sanitizeCarNumber(e.detail.value)
    this.setData({ rosterQuery, rosterScrollTop: 0, rosterFocusId: '' }, () => {
      this.refreshRosterWindow({ scrollTop: 0, resetScroll: true })
    })
  },

  clearRosterSelection() {
    if (this.data.currentCarId) this.clearActiveRecord()
  },

  toggleKeyboardMode() {
    const keyboardMode = this.data.keyboardMode === 'number' ? 'english' : 'number'
    const focusKey = this.data.inputFocusKey
    const focusedPenaltyIndex = this.data.focusedPenaltyIndex
    this.setData({ keyboardMode, inputFocusKey: '', focusedPenaltyIndex: -1 }, () => {
      clearTimeout(this._keyboardFocusTimer)
      if (!focusKey) return
      this._keyboardFocusTimer = setTimeout(() => this.setData({ inputFocusKey: focusKey, focusedPenaltyIndex }), 80)
    })
  },

  onInputFocus(e) {
    const key = String(e && e.currentTarget && e.currentTarget.dataset.focusKey || '')
    if (key === 'penalty') {
      const index = Number(e.currentTarget.dataset.index)
      this.setData({ inputFocusKey: key, focusedPenaltyIndex: Number.isFinite(index) ? index : -1 })
    } else if (key && key !== this.data.inputFocusKey) {
      this.setData({ inputFocusKey: key, focusedPenaltyIndex: -1 })
    }
  },

  uploadAllRecords() {
    if (!normalizeEventId(this.data.eventId) || !this.data.allowed || !this.data.eventScopeReady || this.data.uploading || this._batchInFlight) return
    wx.showModal({
      title: '确认上传',
      content: '将上传当前赛事所有已填写数据的赛段记录，并记录上传人手机号，是否继续？',
      confirmText: '上传',
      cancelText: '取消',
      success: result => {
        if (!result.confirm) return
        const snapshotFlushed = this.flushRows(true)
        if (!snapshotFlushed) {
          wx.showModal({ title: '上传已停止', content: '当前赛段待上传快照未能保存到本机，未开始上传。请检查设备存储后重试。', showCancel: false })
          return
        }
        if (this._cloudSaveInFlight) {
          wx.showModal({ title: '上传已停止', content: '当前赛段正在单独同步，稍后再进行批量上传，避免两个保存请求相互覆盖。', showCancel: false })
          return
        }
        this.setData({ uploading: true })
        const stages = Array.isArray(this.data.stages) ? this.data.stages.slice() : []
        const snapshotFailures = this._pendingSnapshotFailures || {}
        const failedStage = stages.find(stage => snapshotFailures[this.storageKey(stage)])
        if (failedStage) {
          this.setData({ uploading: false })
          wx.showModal({ title: '上传已停止', content: `${failedStage} 的待上传快照之前保存失败，未开始上传。请重新保存该赛段成绩后重试。`, showCancel: false })
          return
        }
        let readFailure = ''
        const skippedMalformedStages = []
        const records = stages.map(stage => {
          let rows = []
          let localRevision = this.getStageRevision(stage)
          let hasPendingSnapshot = false
          const isCurrentStage = stage === this.data.selectedStage
          const hasCurrentRows = isCurrentStage && Array.isArray(this.data.carRows) && this.data.carRows.length > 0
          let storageKey = ''
          let dirty = false
          let pending = null
          let cached = null
          let skipStage = false
          try {
            storageKey = this.storageKey(stage)
            dirty = wx.getStorageSync(this.dirtyStorageKey(stage)) === true
            pending = wx.getStorageSync(this.pendingStorageKey(stage))
            const hasMatchingPending = !!(pending && pending.eventId === normalizeEventId(this.data.eventId))
            cached = wx.getStorageSync(storageKey)
            if (cached != null && !Array.isArray(cached)) {
              // A stale cache from an older build must not prevent another
              // stage from being uploaded. Preserve it for diagnostics, then
              // skip this stage when it has no unsent local work. A dirty or
              // pending snapshot is retained as a hard stop to avoid loss.
              if (dirty || hasMatchingPending) {
                if (!hasCurrentRows) {
                  const error = new Error('本地缓存不是成绩列表')
                  error.hardCacheFailure = true
                  throw error
                }
              } else {
                if (!this.quarantineStorageValue(storageKey, cached)) throw new Error('本地缓存不是成绩列表')
                if (!hasCurrentRows) {
                  skipStage = true
                  skippedMalformedStages.push(stage)
                }
              }
            } else if (Array.isArray(cached)) rows = cached
            if (pending && pending.eventId === normalizeEventId(this.data.eventId)) {
              hasPendingSnapshot = true
              if (!Array.isArray(pending.rows)) {
                const error = new Error('待同步缓存不是成绩列表')
                error.hardCacheFailure = true
                throw error
              }
              rows = pending.rows
              localRevision = Number.isSafeInteger(pending.expectedRevision) && pending.expectedRevision >= 0
                ? pending.expectedRevision
                : null
            }
          } catch (error) {
            // The visible editor is the source of truth for the selected
            // stage. It may already contain a valid cloud/local snapshot even
            // when an old cache entry is malformed, so let it proceed.
            if (error && error.hardCacheFailure) {
              readFailure = readFailure || `${stage} 本地成绩读取失败：${error.message || '存储不可用'}`
            } else if (hasCurrentRows) {
              rows = this.data.carRows
            } else {
              readFailure = readFailure || `${stage} 本地成绩读取失败：${error.message || '存储不可用'}`
            }
          }
          if (skipStage) return { stage, rows: [] }
          if (hasCurrentRows) {
            rows = this.data.carRows
            const pendingCloud = this._pendingCloudRows
            if (pendingCloud && pendingCloud.stage === stage && pendingCloud.eventId === normalizeEventId(this.data.eventId) && Number.isSafeInteger(pendingCloud.expectedRevision)) localRevision = pendingCloud.expectedRevision
          }
          if (isCurrentStage && !hasCurrentRows) {
            const pendingCloud = this._pendingCloudRows
            if (pendingCloud && pendingCloud.stage === stage && pendingCloud.eventId === normalizeEventId(this.data.eventId)) {
              rows = pendingCloud.rows
              localRevision = pendingCloud.expectedRevision
              hasPendingSnapshot = true
            }
          }
          const issue = this.validateRowsForTransfer(rows)
          if (issue) {
            // A clean, non-selected stage may contain a malformed legacy row
            // (for example an old penaltyInputs shape). It is safe to back up
            // and skip that stage: the selected stage remains uploadable and
            // the malformed cache can be repaired later from cloud data. Any
            // dirty/pending cache, or the selected stage, still hard-stops to
            // avoid silently discarding unsynchronized edits.
            const hasMatchingPending = !!(pending && pending.eventId === normalizeEventId(this.data.eventId))
            if (!isCurrentStage && Array.isArray(cached) && !dirty && !hasMatchingPending) {
              if (!this.quarantineStorageValue(storageKey, cached)) {
                readFailure = `${stage} ${issue}`
                return { stage, rows: [] }
              }
              skippedMalformedStages.push(stage)
              return { stage, rows: [] }
            }
            readFailure = `${stage} ${issue}`
            return { stage, rows: [] }
          }
          return { stage, rows, localRevision, hasPendingSnapshot }
        }).filter(item => item.rows.length || item.hasPendingSnapshot)
        if (readFailure) {
          this.setData({ uploading: false })
          wx.showModal({ title: '上传已停止', content: `${readFailure}。未开始上传，请检查本机缓存后重试。`, showCancel: false })
          return
        }
        if (!records.length) {
          this.setData({ uploading: false })
          wx.showToast({ title: '没有可上传的成绩', icon: 'none' })
          return
        }
        const expectedStages = records.length
        const expectedRows = records.reduce((total, item) => total + item.rows.length, 0)
        const eventId = normalizeEventId(this.data.eventId)
        Promise.all(records.map(item => this.callWorkCloud('getWorkRecords', { eventId, stage: item.stage }).then(result => {
          if (!Array.isArray(result.rows) || !Number.isSafeInteger(result.revision) || result.revision < 0) throw new Error(`${item.stage} 云端数据或版本号无效，已停止批量上传`)
          if (result.rows.length > this.data.maxCarRows) throw new Error(`${item.stage} 云端成绩超过本地支持上限，已停止批量上传`)
          const issue = this.validateRowsForTransfer(result.rows)
          if (issue) throw new Error(`${item.stage} 云端成绩校验失败：${issue}；已停止批量上传`)
          if (item.localRevision == null && result.revision > 0) {
            this.markRevisionConflict(item.stage, null, `${item.stage} 本地快照缺少版本号，云端版本为 ${result.revision}；本地数据已保留，未批量覆盖`)
            throw new Error(`${item.stage} 本地快照缺少版本号、云端已存在数据；请刷新核对后再上传`)
          }
          if (item.localRevision != null && item.localRevision !== result.revision) {
            this.markRevisionConflict(item.stage, item.localRevision, `${item.stage} 本地版本 ${item.localRevision} 与云端版本 ${result.revision} 不一致；本地数据已保留，未批量覆盖`)
            throw new Error(`${item.stage} 本地版本与云端不一致，请刷新核对后再上传`)
          }
          item.expectedRevision = result.revision
          return item
        }))).then(verifiedRecords => {
          this._batchInFlight = true
          const uploadRecords = verifiedRecords.map(item => ({
            stage: item.stage,
            expectedRevision: item.expectedRevision,
            rows: item.rows.map((row, index) => this.normalizeRecord(row, index))
          }))
          return this.callWorkCloud('uploadAllWorkRecords', { eventId, records: uploadRecords })
        }).then(result => {
          if (Number(result.stageCount) !== expectedStages || Number(result.rowCount) !== expectedRows) throw new Error(`云端确认 ${result.stageCount || 0}/${expectedStages} 个赛段、${result.rowCount || 0}/${expectedRows} 条；请刷新核对`)
          if (!Array.isArray(result.records) || result.records.length !== expectedStages) throw new Error('云端未返回完整的赛段版本号，已停止本地确认；请刷新各赛段核对')
          const returnedByStage = new Map()
          for (const item of result.records) {
            if (!item || !records.some(record => record.stage === item.stage) || !Number.isSafeInteger(item.revision) || item.revision < 1 || returnedByStage.has(item.stage)) throw new Error('云端返回的赛段版本信息不完整，请刷新各赛段核对')
            returnedByStage.set(item.stage, item.revision)
          }
          if (returnedByStage.size !== expectedStages) throw new Error('云端返回的赛段版本信息不完整，请刷新各赛段核对')
          for (const item of records) {
            const revision = returnedByStage.get(item.stage)
            this.setStageRevision(item.stage, revision)
            this.clearRevisionConflict(item.stage)
            const newerRows = this._pendingRows
              && this._pendingRowsStage === item.stage
              && this._pendingRowsEventId === eventId
              && this._pendingRows !== item.rows
            if (newerRows) {
              this._pendingRowsExpectedRevision = revision
              const durable = { eventId, stage: item.stage, rows: this._pendingRows, expectedRevision: revision }
              try { wx.setStorageSync(this.pendingStorageKey(item.stage), durable) } catch (error) {
                this._pendingSnapshotFailures = this._pendingSnapshotFailures || {}
                this._pendingSnapshotFailures[this.storageKey(item.stage)] = error.message || '待同步版本号更新失败'
                this.setData({ cloudSyncMessage: `${item.stage} 云端已保存较早修改，但新修改快照版本号无法保存；本地数据已保留`, cloudSyncRetryVisible: false })
              }
            }
            const pending = this._pendingCloudRows
            if (pending && pending.stage === item.stage && pending.eventId === eventId && pending.expectedRevision === item.expectedRevision) {
              if (JSON.stringify(pending.rows) === JSON.stringify(item.rows)) {
                this._pendingCloudRows = null
                try { wx.removeStorageSync(this.dirtyStorageKey(item.stage)) } catch (error) {}
                try { wx.removeStorageSync(this.pendingStorageKey(item.stage)) } catch (error) {}
              } else {
                pending.expectedRevision = revision
                try { wx.setStorageSync(this.pendingStorageKey(item.stage), pending) } catch (error) {
                  this._pendingSnapshotFailures = this._pendingSnapshotFailures || {}
                  this._pendingSnapshotFailures[this.storageKey(item.stage)] = error.message || '待同步版本号更新失败'
                }
              }
            }
          }
          const skippedNotice = skippedMalformedStages.length
            ? `\n以下赛段的本地缓存格式异常，已备份并跳过：${skippedMalformedStages.join('、')}。`
            : ''
          if (result.uploadLogSaved === false) {
            wx.showModal({ title: '成绩已上传', content: `${expectedStages} 个赛段、${expectedRows} 条成绩已写入云端，但上传记录日志未能保存。请刷新赛段核对。${skippedNotice}`, showCancel: false })
          } else if (skippedMalformedStages.length) {
            wx.showModal({ title: '上传完成（有赛段跳过）', content: `已上传 ${expectedStages} 个赛段、${expectedRows} 条成绩。${skippedNotice}可稍后重新打开被跳过的赛段，让页面从云端恢复后再上传。`, showCancel: false })
          } else wx.showToast({ title: `已上传${expectedStages}个赛段`, icon: 'success' })
        }).catch(error => {
          const skippedNotice = skippedMalformedStages.length ? `\n已跳过缓存异常赛段：${skippedMalformedStages.join('、')}。` : ''
          wx.showModal({ title: '上传未能确认完整', content: `${error.message || '上传失败'}。多赛段上传中断时，前面的赛段可能已经写入云端，请刷新各赛段核对后再重试。${skippedNotice}`, showCancel: false })
        })
          .finally(() => {
            this._batchInFlight = false
            this.setData({ uploading: false })
            if (this._pendingCloudRows) this.flushPendingCloud()
          })
      }
    })
  },

  onRosterScroll(e) {
    // 成绩表现在一次渲染全部车号，滚动只由 scroll-view 原生处理。
  },

  focusRosterCar(carNumber) {
    const normalized = this.sanitizeCarNumber(carNumber)
    if (!normalized) return
    const record = this.data.carRows.find(row => row.carNumber === normalized)
    if (!record) return
    const query = this.data.rosterQuery && normalized.includes(this.data.rosterQuery)
      ? this.data.rosterQuery
      : ''
    const filtered = this.getRosterFilteredRows(query)
    const targetIndex = filtered.findIndex(row => String(row.id) === String(record.id))
    if (targetIndex < 0) return
    clearTimeout(this._rosterFocusTimer)
    this.setData({ rosterQuery: query, rosterFocusId: record.id }, () => {
      this.refreshRosterWindow({ targetIndex })
      this._rosterFocusTimer = setTimeout(() => this.setData({ rosterFocusId: '' }), 1600)
    })
  },

  normalizeRecord(row, index) {
    row = row && typeof row === 'object' && !Array.isArray(row) ? row : {}
    const normalizedSource = { ...row }
    ;['_id', '_openid', 'openid', 'eventId', 'stage', 'updatedAt', 'revision', 'createdAt', 'updatedBy', 'updatedByPhone', 'updatedByRole'].forEach(key => delete normalizedSource[key])
    const id = String(row.id || ('car_' + Date.now() + '_' + index))
    const carNumber = String(row.carNumber || row.car || '').replace(/[^0-9a-z]/gi, '').toUpperCase()
    const penaltyInputs = Array.isArray(row.penaltyInputs)
      ? row.penaltyInputs.map((item, penaltyIndex) => ({
        ...item,
        id: String(item.id || (id + '_penalty_' + penaltyIndex)),
        value: this.formatPenaltyInput(item.value)
      }))
      : [{ id: id + '_penalty_1', value: '' }]
    const startTime = this.formatClockInput(row.startTime)
    const endTime = this.formatClockInput(row.endTime)
    const imported = row.imported === true
    const calculated = this.calculateResult(startTime, endTime, penaltyInputs)
    const durationManual = row.durationManual === true
    return {
      ...normalizedSource,
      id,
      carNumber,
      swiped: false,
      group: String(row.group || row.groupName || row.teamName || ''),
      startTime,
      endTime,
      penaltyInputs,
      teamName: String(row.teamName || row.groupName || row.group || ''),
      driver: String(row.driver || row.name || ''),
      stage1: String(row.stage1 || ''),
      stage2: String(row.stage2 || ''),
      stage3: String(row.stage3 || ''),
      validScore: String(row.validScore || ''),
      imported,
      importedStage: String(row.importedStage || ''),
      uploader: String(row.uploader || ''),
      uploadedAt: String(row.uploadedAt || ''),
      status: String(row.status || 'pending'),
      note: String(row.note || ''),
      durationManual,
      ...calculated,
      ...(durationManual ? {
        segmentDuration: String(row.segmentDuration || calculated.segmentDuration),
        totalDuration: String(row.totalDuration || calculated.totalDuration)
      } : {})
    }
  },

  validateRowsForTransfer(rows) {
    if (!Array.isArray(rows)) return '成绩列表格式无效'
    if (rows.length > this.data.maxCarRows) return `共有 ${rows.length} 条，超过单赛段上限 ${this.data.maxCarRows} 条`
    const seen = new Set()
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index]
      if (!row || typeof row !== 'object' || Array.isArray(row)) return `第 ${index + 1} 条记录格式无效`
      for (const key of ['carNumber', 'car', 'id', 'group', 'groupName', 'teamName', 'driver', 'name', 'startTime', 'endTime', 'penaltyTotal', 'segmentDuration', 'totalDuration', 'uploader', 'uploadedAt', 'note']) {
        if (row[key] != null && !['string', 'number'].includes(typeof row[key])) return `第 ${index + 1} 条记录的 ${key} 格式无效`
      }
      const car = this.sanitizeCarNumber(row.carNumber || row.car)
      if (!car) return `第 ${index + 1} 条记录没有有效车号`
      if (car.length > 12) return `第 ${index + 1} 条记录车号超过 12 位`
      if (seen.has(car)) return `车号 ${car} 重复`
      seen.add(car)
      if (row.penaltyInputs != null && !Array.isArray(row.penaltyInputs)) return `车号 ${car} 的罚时格式无效`
      if (Array.isArray(row.penaltyInputs) && row.penaltyInputs.length > this.data.maxPenaltyInputs) return `车号 ${car} 的罚时项目超过 ${this.data.maxPenaltyInputs} 项`
      if (Array.isArray(row.penaltyInputs) && row.penaltyInputs.some(item => !item || typeof item !== 'object' || String(item.id || '').length > 80 || String(item.value || '').length > 12 || (/^\d+$/.test(String(item.value || '')) && String(item.value).length > 9))) return `车号 ${car} 有罚时数据超出支持范围`
      for (const field of ['startTime', 'endTime']) {
        const value = String(row[field] || '')
        if (value && (this.digitsOnly(value).length > 9 || this.parseClock(value) === null)) return `车号 ${car} 的${field === 'startTime' ? '发车时间' : '收车时间'}格式无效或超出毫秒精度`
      }
      if (Array.isArray(row.penaltyInputs)) {
        for (const penalty of row.penaltyInputs) {
          const value = String(penalty.value || '').trim()
          if (!value) continue
          if (/^\d+$/.test(value)) {
            if (value.length > 9) return `车号 ${car} 的罚时超过支持范围`
          } else if (!/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/i.test(value) && !(this.digitsOnly(value).length <= 9 && this.parseClock(value) !== null)) {
            return `车号 ${car} 的罚时格式无效`
          }
        }
      }
    }
    try {
      const serialized = JSON.stringify(rows)
      if (typeof serialized !== 'string') return '成绩不是可保存的 JSON 数据'
      const bytes = unescape(encodeURIComponent(serialized)).length
      if (bytes > 700 * 1024) return `成绩内容约 ${Math.ceil(bytes / 1024)} KB，超过 CloudBase 单赛段上限 700 KB`
    } catch (error) {
      return `成绩包含无法保存的 JSON 数据：${error.message || '数据格式无效'}`
    }
    return ''
  },

  normalizeEntryPermissions(value) {
    const source = value && typeof value === 'object' ? value : {}
    return {
      startTime: source.startTime !== false,
      endTime: source.endTime !== false,
      penalty: source.penalty !== false
    }
  },

  hasEntryPermission(name) {
    if (this.data.isAdmin) return true
    const permissions = this.data.entryPermissions || {}
    return permissions[name] !== false
  },

  showEntryPermissionTip(name) {
    const labels = { startTime: '发车时间', endTime: '收车时间', penalty: '罚时' }
    if (!this.hasEntryPermission(name)) {
      wx.showToast({ title: '暂无' + labels[name] + '录入权限', icon: 'none' })
      return false
    }
    return true
  },

  saveRows(rows, stageOverride) {
    if (!normalizeEventId(this.data.eventId) || !this.data.allowed || !this.data.eventScopeReady) return false
    clearTimeout(this._saveTimer)
    this._pendingRows = rows
    this._pendingRowsStage = stageOverride || this.data.selectedStage
    this._pendingRowsEventId = normalizeEventId(this.data.eventId)
    const expectedRevision = this._revisionConflictStages && this._revisionConflictStages[this._pendingRowsStage]
      ? this._revisionConflictExpected[this._pendingRowsStage]
      : this.getStageRevision(this._pendingRowsStage)
    this._pendingRowsExpectedRevision = expectedRevision
    try {
      wx.setStorageSync(this.pendingStorageKey(this._pendingRowsStage), { eventId: this._pendingRowsEventId, stage: this._pendingRowsStage, rows, expectedRevision })
      wx.setStorageSync(this.dirtyStorageKey(this._pendingRowsStage), true)
      if (this._pendingSnapshotFailures) delete this._pendingSnapshotFailures[this.storageKey(this._pendingRowsStage)]
    } catch (error) {
      this._pendingSnapshotFailures = this._pendingSnapshotFailures || {}
      this._pendingSnapshotFailures[this.storageKey(this._pendingRowsStage)] = error.message || '待上传快照本地备份失败'
      console.warn('工作后台待同步快照本地备份失败', error)
      this.setData({ cloudSyncMessage: '本地待同步备份失败，正在尝试云端；请保持页面打开直到同步成功', cloudSyncRetryVisible: true })
    }
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null
      const pendingRows = this._pendingRows
      const pendingStage = this._pendingRowsStage || this.data.selectedStage
      const pendingEventId = this._pendingRowsEventId || normalizeEventId(this.data.eventId)
      const pendingExpectedRevision = this._pendingRowsExpectedRevision
      this._pendingRows = null
      this._pendingRowsStage = ''
      this._pendingRowsEventId = ''
      this._pendingRowsExpectedRevision = null
      wx.setStorage({
        key: this.storageKey(pendingStage),
        data: pendingRows,
        success: () => { this._saveErrorShown = false },
        fail: error => {
          console.warn('工作后台成绩保存失败', error)
          if (!this._saveErrorShown) {
            this._saveErrorShown = true
            wx.showToast({ title: '成绩保存失败，请重试', icon: 'none' })
          }
        }
      })
      clearTimeout(this._cloudSaveTimer)
      this._pendingCloudRows = { rows: pendingRows, stage: pendingStage, eventId: pendingEventId, expectedRevision: pendingExpectedRevision }
      const conflicted = this._revisionConflictStages && this._revisionConflictStages[pendingStage]
      this.setData({ cloudSyncMessage: conflicted ? `${pendingStage} 存在云端版本冲突；本地修改已保留，未自动重传` : '成绩已保存到本机，等待云端同步', cloudSyncRetryVisible: false })
      this._cloudSaveTimer = setTimeout(() => {
        this._cloudSaveTimer = null
        this.flushPendingCloud()
      }, 500)
    }, 180)
  },

  flushPendingCloud() {
    if (!normalizeEventId(this.data.eventId) || !this.data.allowed || !this.data.eventScopeReady) return
    const pending = this._pendingCloudRows
    if (!pending || !this.data.cloudReady || this._cloudSaveInFlight || this._batchInFlight || (this._revisionConflictStages && this._revisionConflictStages[pending.stage])) return
    if (!Number.isSafeInteger(pending.expectedRevision) || pending.expectedRevision < 0) {
      this.setData({ cloudSyncMessage: `${pending.stage} 本地快照缺少云端版本号，已保留本地修改并停止上传，请刷新该赛段后再试`, cloudSyncRetryVisible: false })
      return
    }
    this._cloudSaveInFlight = true
    this.setData({ cloudSyncMessage: '正在同步成绩到云端', cloudSyncRetryVisible: false })
    this.callWorkCloud('saveWorkRecords', { eventId: pending.eventId, stage: pending.stage, rows: pending.rows, expectedRevision: pending.expectedRevision })
      .then(result => {
        if(Number(result.count)!==pending.rows.length)throw new Error(`云端确认保存 ${result.count||0}/${pending.rows.length} 条`)
        if (!Number.isSafeInteger(result.revision) || result.revision < 0) throw new Error('云端未返回有效版本号；请刷新核对')
        this.setStageRevision(pending.stage, result.revision)
        const newerLiveRows = this._pendingRows
          && this._pendingRowsStage === pending.stage
          && this._pendingRowsEventId === pending.eventId
        if (this._pendingCloudRows === pending && !newerLiveRows) {
          this._pendingCloudRows = null
          clearTimeout(this._cloudRetryTimer)
          this._cloudRetryTimer = null
          try { wx.removeStorageSync(this.dirtyStorageKey(pending.stage)) } catch (error) {}
          try { wx.removeStorageSync(this.pendingStorageKey(pending.stage)) } catch (error) {}
          this.setData({ cloudSyncMessage: '云端已同步', cloudSyncRetryVisible: false })
        } else if (newerLiveRows) {
          // A user edit landed while the request was in flight. Carry the
          // confirmed revision into that newer durable snapshot so the next
          // write can follow it instead of falsely colliding with its own
          // predecessor.
          this._pendingRowsExpectedRevision = result.revision
          this._pendingCloudRows = { rows: this._pendingRows, stage: pending.stage, eventId: pending.eventId, expectedRevision: result.revision }
          try {
            wx.setStorageSync(this.pendingStorageKey(pending.stage), this._pendingCloudRows)
          } catch (error) {
            this._pendingSnapshotFailures = this._pendingSnapshotFailures || {}
            this._pendingSnapshotFailures[this.storageKey(pending.stage)] = error.message || '待同步版本号更新失败'
            this.setData({ cloudSyncMessage: '云端已保存较早修改，但新修改的版本号快照保存失败；本地数据已保留，请勿离开页面', cloudSyncRetryVisible: false })
          }
        } else if (this._pendingCloudRows
          && this._pendingCloudRows.stage === pending.stage
          && this._pendingCloudRows.eventId === pending.eventId
          && this._pendingCloudRows.expectedRevision === pending.expectedRevision) {
          this._pendingCloudRows.expectedRevision = result.revision
          try {
            wx.setStorageSync(this.pendingStorageKey(pending.stage), this._pendingCloudRows)
          } catch (error) {
            this._pendingSnapshotFailures = this._pendingSnapshotFailures || {}
            this._pendingSnapshotFailures[this.storageKey(pending.stage)] = error.message || '待同步版本号更新失败'
            this.setData({ cloudSyncMessage: '云端已保存较早修改，但新修改的版本号快照保存失败；本地数据已保留，请勿离开页面', cloudSyncRetryVisible: false })
            return
          }
        }
      })
      .catch(error => {
        console.warn('云端成绩保存失败', error)
        if (/成绩已被其他设备修改/.test(String(error && error.message || '')) || error.code === 'REVISION_CONFLICT') {
          this.markRevisionConflict(pending.stage, pending.expectedRevision, `成绩已被其他设备修改；${pending.stage} 本地修改已保留，未自动覆盖云端，请刷新赛段核对后再编辑`)
          return
        }
        this.setData({ cloudSyncMessage: `云端未同步：${error.message||'请重试'}`, cloudSyncRetryVisible: true })
        clearTimeout(this._cloudRetryTimer)
        if (!this._pageUnloaded) this._cloudRetryTimer = setTimeout(() => this.flushPendingCloud(), 5000)
      })
      .finally(() => {
        this._cloudSaveInFlight = false
        // 只立即提交新产生的快照；失败的同一快照等退避后再试，避免请求风暴。
        if (this._pendingCloudRows && this._pendingCloudRows !== pending) this.flushPendingCloud()
      })
  },

  retryCloudSync() {
    if (this._revisionConflictStages && this._revisionConflictStages[this.data.selectedStage]) {
      wx.showToast({ title: '存在版本冲突，请刷新赛段核对', icon: 'none' })
      return
    }
    clearTimeout(this._cloudRetryTimer)
    this._cloudRetryTimer = null
    if (this._pendingCloudRows && this.data.cloudReady) this.flushPendingCloud()
    else this.syncCloudRows(this.data.selectedStage)
  },

  flushRows(skipCloudSync) {
    if (!normalizeEventId(this.data.eventId)) return !this._pendingRows && !this._pendingCloudRows
    if (this._saveTimer) clearTimeout(this._saveTimer)
    this._saveTimer = null
    let snapshotFlushed = true
    if (this._pendingRows) {
      const pendingRows = this._pendingRows
      const pendingStage = this._pendingRowsStage || this.data.selectedStage
      const pendingEventId = this._pendingRowsEventId || normalizeEventId(this.data.eventId)
      const pendingExpectedRevision = this._pendingRowsExpectedRevision
      try {
        wx.setStorageSync(this.storageKey(pendingStage), pendingRows)
        if (this._pendingSnapshotFailures) delete this._pendingSnapshotFailures[this.storageKey(pendingStage)]
        this._pendingRows = null
        this._pendingRowsStage = ''
        this._pendingRowsEventId = ''
        this._pendingRowsExpectedRevision = null
        this._pendingCloudRows = { rows: pendingRows, stage: pendingStage, eventId: pendingEventId, expectedRevision: pendingExpectedRevision }
        try {
          wx.setStorageSync(this.pendingStorageKey(pendingStage), this._pendingCloudRows)
        } catch (error) {
          snapshotFlushed = false
          this._pendingSnapshotFailures = this._pendingSnapshotFailures || {}
          this._pendingSnapshotFailures[this.storageKey(pendingStage)] = error.message || '待上传快照写入失败'
          this.setData({ cloudSyncMessage: '本地待上传快照保存失败，未开始上传', cloudSyncRetryVisible: true })
          this._pendingCloudRows = { rows: pendingRows, stage: pendingStage, eventId: pendingEventId, expectedRevision: pendingExpectedRevision }
        }
      } catch (error) {
        snapshotFlushed = false
        this._pendingSnapshotFailures = this._pendingSnapshotFailures || {}
        this._pendingSnapshotFailures[this.storageKey(pendingStage)] = error.message || '成绩快照写入失败'
        console.warn('工作后台成绩退出前保存失败', error)
        this.setData({ cloudSyncMessage: '本地快照保存失败，尚未开始云端上传', cloudSyncRetryVisible: true })
      }
    }
    if (!snapshotFlushed) return false
    clearTimeout(this._cloudSaveTimer)
    this._cloudSaveTimer = null
    if (!skipCloudSync) this.flushPendingCloud()
    return true
  },

  sanitizeCarNumber(value) {
    return String(value || '').replace(/[^0-9a-z]/gi, '').toUpperCase()
  },

  digitsOnly(value, maxLength) {
    const digits = String(value || '').replace(/\D/g, '')
    return typeof maxLength === 'number' ? digits.slice(0, maxLength) : digits
  },

  formatClockInput(value) {
    const digits = this.digitsOnly(value)
    if (!digits) return ''
    let formatted = digits.slice(0, 2)
    if (digits.length > 2) formatted += ':' + digits.slice(2, 4)
    if (digits.length > 4) formatted += ':' + digits.slice(4, 6)
    if (digits.length > 6) formatted += '.' + digits.slice(6, 9)
    return formatted
  },

  formatDisplayClock(value) {
    const text = String(value || '')
    if (!text) return ''
    const match = text.match(/^(\d{1,2}:\d{2}:\d{2})(?:\.(\d{1,3}))?$/)
    if (!match) return text
    // 成绩表中整秒时间不显示无意义的 .000；非零毫秒保留原有精度。
    const milliseconds = String(match[2] || '').replace(/0+$/, '')
    return match[1] + (milliseconds ? '.' + milliseconds : '')
  },

  formatDisplayEndClock(value) {
    const text = String(value || '')
    if (!text) return ''
    const match = text.match(/^(\d{1,2}:\d{2}:\d{2})(?:\.(\d{1,3}))?$/)
    if (!match) return text
    const milliseconds = String(match[2] || '').padEnd(3, '0').slice(0, 3)
    return match[1] + '.' + milliseconds
  },

  parseClock(value) {
    let digits = this.digitsOnly(value)
    if (digits.length > 9) return null
    // 允许用户输入一位秒数，例如 13:12:2，按 13:12:02 解析。
    if (digits.length === 5) digits = digits.slice(0, 4) + '0' + digits.slice(4)
    if (digits.length < 6) return null
    const hours = Number(digits.slice(0, 2))
    const minutes = Number(digits.slice(2, 4))
    const seconds = Number(digits.slice(4, 6))
    const milliseconds = Number((digits.slice(6, 9) + '000').slice(0, 3))
    if (hours > 23 || minutes > 59 || seconds > 59) return null
    return ((hours * 60 * 60 + minutes * 60 + seconds) * 1000) + milliseconds
  },

  normalizeClockInput(value) {
    let digits = this.digitsOnly(value)
    if (digits.length === 5) digits = digits.slice(0, 4) + '0' + digits.slice(4)
    return this.formatClockInput(digits)
  },

  formatDuration(milliseconds) {
    const value = Math.max(0, Math.round(Number(milliseconds) || 0))
    const hours = Math.floor(value / 3600000)
    const minutes = Math.floor((value % 3600000) / 60000)
    const seconds = Math.floor((value % 60000) / 1000)
    const remainder = value % 1000
    const clock = String(hours) + ':' + [minutes, seconds].map(item => String(item).padStart(2, '0')).join(':')
    if (!remainder) return clock
    return clock + '.' + String(remainder).padStart(3, '0').replace(/0+$/, '')
  },

  formatPenaltyDuration(milliseconds) {
    const value = Math.max(0, Math.round(Number(milliseconds) || 0))
    return String(Math.floor(value / 1000))
  },

  formatPenaltyInput(value) {
    // 罚时统一按整数秒录入；读取旧数据时兼容原来的时分秒格式。
    const text = String(value == null ? '' : value).trim()
    if (!text) return ''
    if (/^\d+$/.test(text)) return text
    const legacyUnits = text.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/i)
    if (legacyUnits && (legacyUnits[1] || legacyUnits[2] || legacyUnits[3])) {
      return String((Number(legacyUnits[1] || 0) * 3600) + (Number(legacyUnits[2] || 0) * 60) + Number(legacyUnits[3] || 0))
    }
    const legacyClock = this.parseClock(text)
    return legacyClock === null ? this.digitsOnly(text) : String(Math.floor(legacyClock / 1000))
  },

  parsePenalty(value) {
    const text = String(value == null ? '' : value).trim()
    if (!text) return 0
    if (/^\d+$/.test(text)) return Number(text) * 1000
    // 兼容云端已有的旧 h/m/s 罚时记录，新的输入不会再生成这种格式。
    const match = text.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/i)
    if (!match || (!match[1] && !match[2] && !match[3])) return 0
    return ((Number(match[1] || 0) * 3600) + (Number(match[2] || 0) * 60) + Number(match[3] || 0)) * 1000
  },

  calculateResult(startTime, endTime, penaltyInputs) {
    const start = this.parseClock(startTime)
    const end = this.parseClock(endTime)
    const penaltyTotal = (penaltyInputs || []).reduce((sum, item) => sum + this.parsePenalty(item.value), 0)
    let segment = null
    if (start !== null && end !== null) {
      segment = end - start
      if (segment < 0) segment += 24 * 60 * 60 * 1000
    }
    return {
      penaltyTotal: this.formatPenaltyDuration(penaltyTotal),
      segmentDuration: segment === null ? '待输入' : this.formatDuration(segment),
      totalDuration: segment === null ? '待输入' : this.formatDuration(segment + penaltyTotal)
    }
  },

  activateRecord(record) {
    if (!record) return
    this.setData({
      currentCarId: record.id,
      currentCarNumber: record.carNumber,
      startTime: record.startTime,
      endTime: record.endTime,
      penaltyInputs: record.penaltyInputs,
      startCursor: String(record.startTime || '').length,
      endCursor: String(record.endTime || '').length,
      penaltyCursors: (record.penaltyInputs || []).map(item => String(item.value || '').length),
      penaltyTotal: record.penaltyTotal,
      segmentDuration: record.segmentDuration,
      totalDuration: record.totalDuration
    })
  },

  clearActiveRecord() {
    this.setData({
      currentCarId: '',
      currentCarNumber: '',
      startTime: '',
      endTime: '',
      penaltyInputs: [{ id: 'initial_penalty', value: '' }],
      startCursor: 0,
      endCursor: 0,
      penaltyCursors: [0],
      penaltyTotal: '0',
      segmentDuration: '待输入',
      totalDuration: '待输入'
    })
  },

  onCarNumberInput(e) {
    const carInput = this.sanitizeCarNumber(e.detail.value)
    const nextData = { carInput }
    if (carInput && this.data.currentCarId && carInput !== this.data.currentCarNumber) {
      Object.assign(nextData, {
        currentCarId: '',
        currentCarNumber: '',
        startTime: '',
        endTime: '',
        penaltyInputs: [{ id: 'draft_penalty', value: '' }],
        penaltyTotal: '0',
        segmentDuration: '待输入',
        totalDuration: '待输入'
      })
    }
    this.setData(nextData, () => {
      this.updateCanAddState()
      this.focusRosterCar(carInput)
    })
  },

  updateCanAddState() {
    const hasTime = (this.hasEntryPermission('startTime') && !!this.data.startTime) || (this.hasEntryPermission('endTime') && !!this.data.endTime)
    this.setData({
      canAddRecord: !this.data.currentCarId && !!this.data.carInput && hasTime
    })
  },

  validateRecordDraft() {
    const current = this.data.carRows.find(row => String(row.id) === String(this.data.currentCarId || '')) || {}
    const startTime = this.hasEntryPermission('startTime') ? this.formatClockInput(this.data.startTime) : this.formatClockInput(current.startTime)
    const endTime = this.hasEntryPermission('endTime') ? this.formatClockInput(this.data.endTime) : this.formatClockInput(current.endTime)
    if (!startTime && !endTime) {
      wx.showToast({ title: '至少填写发车或收车时间', icon: 'none' })
      return false
    }
    if ((startTime && this.parseClock(startTime) === null) || (endTime && this.parseClock(endTime) === null)) {
      wx.showToast({ title: '时间格式无效，请检查输入', icon: 'none' })
      return false
    }
    const penaltyInputs = this.hasEntryPermission('penalty') ? (this.data.penaltyInputs || []) : []
    const invalidPenalty = penaltyInputs.some(item => !/^\d{0,9}$/.test(String(item.value || '')))
    if (invalidPenalty) {
      wx.showToast({ title: '罚时请输入秒数', icon: 'none' })
      return false
    }
    return true
  },

  saveCarEdit() {
    const currentCarId = String(this.data.currentCarId || '')
    if (!currentCarId) return this.addCar()
    if (!this.validateRecordDraft()) return
    const record = this.data.carRows.find(row => String(row.id) === currentCarId)
    if (!record) {
      this.clearActiveRecord()
      return
    }
    const startTime = this.formatClockInput(this.data.startTime)
    const endTime = this.formatClockInput(this.data.endTime)
    const penaltyInputs = (this.hasEntryPermission('penalty') ? (this.data.penaltyInputs || []) : []).slice(0, this.data.maxPenaltyInputs).map((item, index) => ({
      id: String(item.id || (currentCarId + '_penalty_' + (index + 1))),
      value: this.formatPenaltyInput(item.value)
    }))
    const savedStartTime = this.hasEntryPermission('startTime') ? startTime : record.startTime
    const savedEndTime = this.hasEntryPermission('endTime') ? endTime : record.endTime
    const savedPenaltyInputs = this.hasEntryPermission('penalty') ? penaltyInputs : record.penaltyInputs
    const updated = {
      ...record,
      startTime: savedStartTime,
      endTime: savedEndTime,
      penaltyInputs: savedPenaltyInputs,
      durationManual: false,
      ...this.calculateResult(savedStartTime, savedEndTime, savedPenaltyInputs)
    }
    const carRows = this.data.carRows.map(row => String(row.id) === currentCarId ? updated : row)
    this.setData({ carRows, startTime: savedStartTime, endTime: savedEndTime, penaltyInputs: savedPenaltyInputs, ...this.calculateResult(savedStartTime, savedEndTime, savedPenaltyInputs) }, () => this.refreshRosterWindow())
    this.saveRows(carRows)
    wx.showToast({ title: '修改已保存', icon: 'success' })
  },

  addCar() {
    const carNumber = this.sanitizeCarNumber(this.data.carInput)
    if (!carNumber) {
      wx.showToast({ title: '请输入车号', icon: 'none' })
      return
    }
    if (carNumber.length > 12) {
      wx.showToast({ title: '车号不能超过12位', icon: 'none' })
      return
    }
    const startTime = this.hasEntryPermission('startTime') ? this.formatClockInput(this.data.startTime) : ''
    const endTime = this.hasEntryPermission('endTime') ? this.formatClockInput(this.data.endTime) : ''
    if (!startTime && !endTime) {
      wx.showToast({ title: '至少填写发车或收车时间', icon: 'none' })
      return
    }
    if ((startTime && this.parseClock(startTime) === null) || (endTime && this.parseClock(endTime) === null)) {
      wx.showToast({ title: '时间格式无效，请检查输入', icon: 'none' })
      return
    }
    const draftPenaltyInputs = this.hasEntryPermission('penalty') ? (this.data.penaltyInputs || []) : []
    const invalidPenalty = draftPenaltyInputs.some(item => !/^\d{0,9}$/.test(String(item.value || '')))
    if (invalidPenalty) {
      wx.showToast({ title: '罚时请输入秒数', icon: 'none' })
      return
    }
    const existing = this.data.carRows.find(row => row.carNumber === carNumber)
    if (existing) {
      wx.showToast({ title: '车号已存在，请点击表格编辑', icon: 'none' })
      return
    }
    if (this.data.carRows.length >= this.data.maxCarRows) {
      wx.showToast({ title: '车号最多保存1000个', icon: 'none' })
      return
    }
    const id = 'car_' + Date.now() + '_' + this.data.carRows.length
    const penaltyInputs = (this.hasEntryPermission('penalty') ? (this.data.penaltyInputs || []) : []).slice(0, this.data.maxPenaltyInputs).map((item, index) => ({
      id: String(item.id || (id + '_penalty_' + (index + 1))),
      value: this.formatPenaltyInput(item.value)
    }))
    const record = {
      id,
      carNumber,
      swiped: false,
      startTime,
      endTime,
      penaltyInputs,
      ...this.calculateResult(startTime, endTime, penaltyInputs)
    }
    const carRows = this.data.carRows.concat(record)
    this.setData({ carRows, carInput: '', canAddRecord: false }, () => this.refreshRosterWindow())
    this.saveRows(carRows)
    // 新增完成后保持“继续录入”状态，不自动选中新车号；
    // 只有用户主动点击成绩表中的车号时才进入编辑状态。
    this.clearActiveRecord()
  },

  selectCar(e) {
    if (this._ignoreRowTap) {
      this._ignoreRowTap = false
      return
    }
    const id = String(e.currentTarget.dataset.id || '')
    const record = this.data.carRows.find(row => String(row.id) === id)
    if (record) {
      const carRows = this.data.carRows.map(row => ({ ...row, swiped: false }))
      this.setData({ carRows }, () => {
        this.refreshRosterWindow()
        this.activateRecord(record)
      })
    }
  },

  onRowTouchStart(e) {
    const id = String(e.currentTarget.dataset.id || '')
    const touch = e.touches && e.touches[0]
    if (!id || !touch) return
    this._rowSwipe = {
      id,
      startX: touch.clientX === undefined ? touch.pageX : touch.clientX,
      deltaX: 0
    }
  },

  onRowTouchMove(e) {
    if (!this._rowSwipe) return
    const touch = e.touches && e.touches[0]
    if (!touch) return
    const currentX = touch.clientX === undefined ? touch.pageX : touch.clientX
    this._rowSwipe.deltaX = currentX - this._rowSwipe.startX
  },

  onRowTouchEnd() {
    const swipe = this._rowSwipe
    this._rowSwipe = null
    if (!swipe || Math.abs(swipe.deltaX) < 24) return
    this._ignoreRowTap = true
    clearTimeout(this._rowTapTimer)
    this._rowTapTimer = setTimeout(() => {
      this._ignoreRowTap = false
    }, 300)
    const carRows = this.data.carRows.map(row => ({
      ...row,
      swiped: swipe.deltaX < 0 && String(row.id) === swipe.id
    }))
    this.setData({ carRows }, () => this.refreshRosterWindow())
  },

  removeCar(e) {
    this._ignoreRowTap = false
    const id = String(e.currentTarget.dataset.id || '')
    const record = this.data.carRows.find(row => String(row.id) === id)
    if (!record) return
    wx.showModal({
      title: '清除车号',
      content: '确定要清除车号 ' + record.carNumber + ' 吗？',
      confirmText: '确定',
      cancelText: '取消',
      success: result => {
        if (!result.confirm) return
        const carRows = this.data.carRows.filter(row => String(row.id) !== id)
        this.setData({ carRows }, () => this.refreshRosterWindow())
        this.saveRows(carRows)
        if (id === String(this.data.currentCarId)) {
          if (carRows.length) this.activateRecord(carRows[0])
          else this.clearActiveRecord()
        }
      }
    })
  },

  updateClock(field, value) {
    if (!this.showEntryPermissionTip(field)) return
    const formatted = this.formatClockInput(value)
    this.refreshResult({ [field]: formatted, __cursor: formatted.length })
  },

  onStartInput(e) {
    if (!this.showEntryPermissionTip('startTime')) return
    this.updateClock('startTime', e.detail.value)
  },

  onStartFieldTap() {
    this.showEntryPermissionTip('startTime')
  },

  onStartBlur() {
    if (!this.hasEntryPermission('startTime')) return
    this.validateClockField(this.data.startTime, '发车时间')
  },

  onEndInput(e) {
    if (!this.showEntryPermissionTip('endTime')) return
    this.updateClock('endTime', e.detail.value)
  },

  onEndFieldTap() {
    this.showEntryPermissionTip('endTime')
  },

  onEndBlur() {
    if (!this.hasEntryPermission('endTime')) return
    this.validateClockField(this.data.endTime, '收车时间')
  },

  validateClockField(value, label) {
    if (!value) return true
    if (this.parseClock(value) !== null) {
      const normalized = this.normalizeClockInput(value)
      if (normalized !== value) {
        const field = label === '发车时间' ? 'startTime' : 'endTime'
        this.refreshResult({ [field]: normalized, __cursor: normalized.length })
      }
      return true
    }
    wx.showToast({ title: label + '格式无效', icon: 'none' })
    return false
  },

  refreshResult(nextData) {
    const draft = {
      startTime: nextData.startTime === undefined ? this.data.startTime : nextData.startTime,
      endTime: nextData.endTime === undefined ? this.data.endTime : nextData.endTime,
      penaltyInputs: nextData.penaltyInputs === undefined ? this.data.penaltyInputs : nextData.penaltyInputs
    }
    const result = this.calculateResult(draft.startTime, draft.endTime, draft.penaltyInputs)
    const currentCarId = String(this.data.currentCarId || '')
    const rowIndex = this.data.carRows.findIndex(row => String(row.id) === currentCarId)
    const updated = rowIndex >= 0 ? { ...this.data.carRows[rowIndex], ...draft, ...result } : null
    const viewData = { ...draft, ...result }
    if (nextData.__cursor !== undefined) {
      if (nextData.startTime !== undefined) viewData.startCursor = nextData.__cursor
      if (nextData.endTime !== undefined) viewData.endCursor = nextData.__cursor
    }
    if (nextData.__penaltyCursors) viewData.penaltyCursors = nextData.__penaltyCursors
    if (updated) viewData['carRows[' + rowIndex + ']'] = updated
    this.setData(viewData, () => {
      this.updateCanAddState()
      this.refreshRosterWindow()
    })
    if (updated) {
      const carRows = this.data.carRows.slice()
      carRows[rowIndex] = updated
      this.saveRows(carRows)
    }
  },

  onPenaltyInput(e) {
    if (!this.showEntryPermissionTip('penalty')) return
    const index = Number(e.currentTarget.dataset.index)
    const penaltyInputs = this.data.penaltyInputs.slice()
    if (!penaltyInputs[index]) return
    penaltyInputs[index] = {
      ...penaltyInputs[index],
      value: this.formatPenaltyInput(e.detail.value)
    }
    const penaltyCursors = (this.data.penaltyCursors || []).slice()
    penaltyCursors[index] = penaltyInputs[index].value.length
    this.refreshResult({ penaltyInputs, __penaltyCursors: penaltyCursors })
  },

  onPenaltyFieldTap() {
    this.showEntryPermissionTip('penalty')
  },

  onPenaltyBlur(e) {
    if (!this.hasEntryPermission('penalty')) return
    const index = Number(e.currentTarget.dataset.index)
    const item = this.data.penaltyInputs[index]
    if (!item || !item.value) return
    if (!/^\d{0,9}$/.test(String(item.value || ''))) wx.showToast({ title: '罚时请输入秒数', icon: 'none' })
  },

  addPenalty() {
    if (!this.showEntryPermissionTip('penalty')) return
    const { penaltyInputs, maxPenaltyInputs } = this.data
    if (penaltyInputs.length >= maxPenaltyInputs) {
      wx.showToast({ title: '罚时最多添加10项', icon: 'none' })
      return
    }
    const next = penaltyInputs.concat({ id: this.data.currentCarId + '_penalty_' + Date.now(), value: '' })
    this.refreshResult({ penaltyInputs: next, __penaltyCursors: (this.data.penaltyCursors || []).concat(0) })
  },

  removePenalty(e) {
    if (!this.showEntryPermissionTip('penalty')) return
    const index = Number(e.currentTarget.dataset.index)
    const penaltyInputs = this.data.penaltyInputs.slice()
    if (penaltyInputs.length <= 1 || !penaltyInputs[index]) return
    penaltyInputs.splice(index, 1)
    const penaltyCursors = (this.data.penaltyCursors || []).slice()
    penaltyCursors.splice(index, 1)
    this.refreshResult({ penaltyInputs, __penaltyCursors: penaltyCursors })
  }
})

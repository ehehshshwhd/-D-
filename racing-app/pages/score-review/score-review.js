const { ALL_STAGES } = require('../../utils/stages')
const auth = require('../../utils/auth')
const config = require('../../config/cloud')

Page({
  data: {
    eventOptions: [{ id: 'suiping', name: '2026 中国·遂平嵖岈山首届汽车越野嘉年华', date: '2026.08.23 — 08.30', status: '已完赛' }],
    eventIndex: 0, eventId: 'suiping', eventName: '2026 中国·遂平嵖岈山首届汽车越野嘉年华', eventDate: '2026.08.23 — 08.30', eventStatus: '已完赛',
    stages: ['ALL'].concat(ALL_STAGES), selectedStage: 'ALL',
    filterOptions: [{ key: 'all', label: '全部' }, { key: 'pending', label: '待审核' }, { key: 'passed', label: '已通过' }], selectedFilter: 'all',
    records: [], filteredRecords: [], expandedId: '', pendingCount: 0, passedCount: 0, totalCount: 0, busy: false,
    searchQuery: '', activeNav: 'review', toast: ''
  },
  onLoad(options) { const eventId = String(options && options.eventId || ''); if (eventId) { const index = this.data.eventOptions.findIndex(item => item.id === eventId); if (index >= 0) this.applyEvent(index) } },
  onShow() { if (this.data.eventId) this.loadRecords(this.data.eventId) },
  callReview(action, data) {
    if (!auth.init()) return Promise.reject(new Error('云开发尚未初始化'))
    return wx.cloud.callFunction({ name: config.accountFunction, data: { action, ...(data || {}) } }).then(response => {
      const result = response && response.result
      if (!result || !result.ok) throw new Error(result && result.message || '成绩审核服务暂时不可用')
      return result
    })
  },
  loadRecords(eventId) {
    const requestId = (this._recordsRequestId || 0) + 1
    this._recordsRequestId = requestId
    this.setData({ loading: true })
    this.callReview('listReviewRecords', { eventId }).then(result => {
      if (this._recordsRequestId !== requestId) return
      this.refreshView(result.records || [])
    }).catch(error => {
      if (this._recordsRequestId !== requestId) return
      this.refreshView([])
      wx.showToast({ title: error.message || '成绩读取失败', icon: 'none' })
    }).then(() => {
      if (this._recordsRequestId === requestId) this.setData({ loading: false })
    })
  },
  refreshView(records) { const list = (Array.isArray(records) ? records : []).map(item => ({ ...item, status: ['pending', 'passed', 'returned'].includes(item.status) ? item.status : 'pending', statusLabel: item.statusLabel || (item.status === 'passed' ? '已通过' : item.status === 'returned' ? '已退回' : '待审核') })); const pending = list.filter(item => item.status === 'pending').length; const passed = list.filter(item => item.status === 'passed').length; const query = String(this.data.searchQuery || '').trim().toUpperCase(); const stageRecords = this.data.selectedStage === 'ALL' ? list : list.filter(item => item.stage === this.data.selectedStage); const filterRecords = this.data.selectedFilter === 'all' ? stageRecords : stageRecords.filter(item => item.status === this.data.selectedFilter); const filteredRecords = query ? filterRecords.filter(item => String(item.carNumber || '').toUpperCase().includes(query)) : filterRecords; this.setData({ records: list, filteredRecords, pendingCount: pending, passedCount: passed, totalCount: list.length }) },
  applyEvent(index) { const event = this.data.eventOptions[index]; if (!event) return; this.setData({ eventIndex: index, eventId: event.id, eventName: event.name, eventDate: event.date, eventStatus: event.status, selectedStage: 'ALL', selectedFilter: 'all', expandedId: '' }, () => this.loadRecords(event.id)) },
  onEventChange(e) { this.applyEvent(Number(e.detail.value)) },
  selectStage(e) { const stage = String(e.currentTarget.dataset.stage || 'ALL'); this.setData({ selectedStage: stage, expandedId: '' }, () => this.refreshView(this.data.records)) },
  selectFilter(e) { const filter = String(e.currentTarget.dataset.filter || 'all'); this.setData({ selectedFilter: filter, expandedId: '' }, () => this.refreshView(this.data.records)) },
  onSearchInput(e) { this.setData({ searchQuery: String(e.detail.value || '') }, () => this.refreshView(this.data.records)) },
  importExcel() { wx.showModal({ title: '导入 Excel', content: '下一步将支持选择 Excel、预览校验并导入待审核成绩。', showCancel: false, confirmText: '知道了' }) },
  exportExcel() { wx.showToast({ title: '已生成导出任务', icon: 'none' }) },
  toggleRecord(e) { const id = String(e.currentTarget.dataset.id || ''); this.setData({ expandedId: this.data.expandedId === id ? '' : id }) },
  approveAllScores() {
    if (!this.data.totalCount || this.data.busy) { wx.showToast({ title: '暂无可审核成绩', icon: 'none' }); return }
    wx.showModal({ title: '一键通过全部成绩', content: `当前赛事共有 ${this.data.totalCount} 条成绩，将全部标记为已通过并允许发布，是否继续？`, confirmText: '确认通过', cancelText: '取消', success: result => {
      if (!result.confirm) return
      this.setData({ busy: true })
      this.callReview('approveAllScores', { eventId: this.data.eventId }).then(response => {
        wx.showToast({ title: `已通过 ${response.approvedCount || 0} 条`, icon: 'success' })
        return this.loadRecords(this.data.eventId)
      }).catch(error => wx.showToast({ title: error.message || '成绩批量审核失败', icon: 'none' })).then(() => this.setData({ busy: false }))
    } })
  },
  publishScores() { if (!this.data.records.length) { wx.showToast({ title: '暂无可发布成绩', icon: 'none' }); return } if (this.data.pendingCount) { wx.showModal({ title: '还有待审核记录', content: '请先处理完待审核记录，再发布成绩。', showCancel: false, confirmText: '知道了' }); return } wx.showModal({ title: '发布成绩', content: (this.data.selectedStage === 'ALL' ? '总成绩' : this.data.selectedStage) + '将对普通用户可见，是否继续？', confirmText: '确认发布', cancelText: '取消', success: result => { if (!result.confirm) return; this.setData({ busy: true }); setTimeout(() => { this.setData({ busy: false }); wx.showToast({ title: '已发布', icon: 'success' }) }, 450) } }) }
})

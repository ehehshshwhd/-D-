const auth = require('../../utils/auth')
const config = require('../../config/cloud')
const { ALL_STAGES } = require('../../utils/stages')

Page({
  data: {
    checking: true,
    allowed: false,
    busy: false,
    admins: [],
    staff: [],
    adminRows: [],
    staffRows: [],
    permissionFilter: 'staff',
    permissionQuery: '',
    activeAdminCount: 0,
    activeStaffCount: 0,
    phoneNumber: '',
    label: '',
    role: 'staff',
    stageOptions: ALL_STAGES.slice(),
    stagePermissions: ALL_STAGES.slice(),
    stageChoices: ALL_STAGES.map(name => ({ name, checked: true })),
    entryPermissions: { startTime: true, endTime: true, penalty: true },
    entryPermissionChoices: [
      { name: 'startTime', label: '发车时间', checked: true },
      { name: 'endTime', label: '收车时间', checked: true },
      { name: 'penalty', label: '罚时', checked: true }
    ]
  },

  onShow() {
    this.setData({ checking: true })
    auth.refreshRole().then(user => {
      const allowed = !!(user && user.isAdmin)
      this.setData({ allowed, checking: false, isSuperAdmin: !!(user && user.isSuperAdmin), isAdmin: !!(user && user.isAdmin) })
      if (allowed) this.loadPermissions()
      else wx.showToast({ title: '仅管理员可进入权限管理', icon: 'none' })
    }).catch(() => {
      this.setData({ allowed: false, checking: false })
      wx.showToast({ title: '权限校验失败', icon: 'none' })
    })
  },

  call(action, data) {
    return wx.cloud.callFunction({
      name: config.accountFunction,
      data: { action, ...(data || {}) }
    }).then(response => {
      const result = response && response.result
      if (!result || !result.ok) throw new Error(result && result.message || '权限服务暂时不可用')
      return result
    })
  },

  loadPermissions() {
    this.setData({ busy: true })
    this.call('listPermissions').then(result => {
      this.applyPermissionLists(result.admins || [], result.staff || [])
    }).catch(error => {
      wx.showToast({ title: error.message || '加载失败', icon: 'none' })
    }).then(() => this.setData({ busy: false }))
  },

  applyPermissionLists(admins, staff) {
    const query = String(this.data.permissionQuery || '').trim().toUpperCase()
    const filterRows = rows => query
      ? rows.filter(item => String(item.phoneNumber || '').includes(query) || String(item.label || '').toUpperCase().includes(query))
      : rows
    this.setData({
      admins,
      staff,
      adminRows: filterRows(admins),
      staffRows: filterRows(staff),
      activeAdminCount: admins.filter(item => item.enabled).length,
      activeStaffCount: staff.filter(item => item.enabled).length
    })
  },

  onPermissionSearchInput(e) {
    this.setData({ permissionQuery: String(e.detail.value || '') }, () => this.applyPermissionLists(this.data.admins, this.data.staff))
  },

  choosePermissionFilter(e) {
    this.setData({ permissionFilter: e.currentTarget.dataset.filter || 'staff' })
  },

  selectAllStages() {
    const stagePermissions = this.data.stageOptions.slice()
    this.setData({ stagePermissions, stageChoices: this.data.stageOptions.map(name => ({ name, checked: true })) })
  },

  clearStages() {
    this.setData({ stagePermissions: [], stageChoices: this.data.stageOptions.map(name => ({ name, checked: false })) })
  },

  normalizeEntryPermissions(value) {
    const source = value && typeof value === 'object' ? value : {}
    return {
      startTime: source.startTime !== false,
      endTime: source.endTime !== false,
      penalty: source.penalty !== false
    }
  },

  entryPermissionChoices(entryPermissions) {
    return [
      { name: 'startTime', label: '发车时间', checked: !!entryPermissions.startTime },
      { name: 'endTime', label: '收车时间', checked: !!entryPermissions.endTime },
      { name: 'penalty', label: '罚时', checked: !!entryPermissions.penalty }
    ]
  },

  selectAllEntryPermissions() {
    const entryPermissions = { startTime: true, endTime: true, penalty: true }
    this.setData({ entryPermissions, entryPermissionChoices: this.entryPermissionChoices(entryPermissions) })
  },

  clearEntryPermissions() {
    const entryPermissions = { startTime: false, endTime: false, penalty: false }
    this.setData({ entryPermissions, entryPermissionChoices: this.entryPermissionChoices(entryPermissions) })
  },

  onEntryPermissionChange(e) {
    const enabled = (e.detail.value || []).map(name => String(name))
    const entryPermissions = {
      startTime: enabled.includes('startTime'),
      endTime: enabled.includes('endTime'),
      penalty: enabled.includes('penalty')
    }
    this.setData({ entryPermissions, entryPermissionChoices: this.entryPermissionChoices(entryPermissions) })
  },

  onPhoneInput(e) {
    this.setData({ phoneNumber: String(e.detail.value || '').replace(/\D/g, '').slice(0, 15) })
  },

  onLabelInput(e) {
    this.setData({ label: String(e.detail.value || '').slice(0, 30) })
  },

  editPermission(e) {
    const id = String(e.currentTarget.dataset.id || '')
    const item = this.data.staff.find(record => String(record.id) === id)
    if (!item) return
    const entryPermissions = this.normalizeEntryPermissions(item.entryPermissions)
    this.setData({
      phoneNumber: item.phoneNumber || '',
      label: item.label || '',
      role: 'staff',
      stagePermissions: Array.isArray(item.stagePermissions) ? item.stagePermissions : this.data.stageOptions.slice(),
      stageChoices: this.data.stageOptions.map(name => ({ name, checked: (Array.isArray(item.stagePermissions) ? item.stagePermissions : this.data.stageOptions).includes(name) })),
      entryPermissions,
      entryPermissionChoices: this.entryPermissionChoices(entryPermissions)
    })
    wx.pageScrollTo({ scrollTop: 0, duration: 180 })
  },

  chooseRole(e) {
    const role = e.currentTarget.dataset.role === 'admin' ? 'admin' : 'staff'
    const stagePermissions = role === 'admin' ? this.data.stageOptions.slice() : this.data.stagePermissions
    const entryPermissions = role === 'admin' ? { startTime: true, endTime: true, penalty: true } : this.data.entryPermissions
    this.setData({ role, stagePermissions, stageChoices: this.data.stageOptions.map(name => ({ name, checked: stagePermissions.includes(name) })), entryPermissions, entryPermissionChoices: this.entryPermissionChoices(entryPermissions) })
  },

  onStageChange(e) {
    const stagePermissions = (e.detail.value || []).map(stage => String(stage).toUpperCase())
    this.setData({ stagePermissions, stageChoices: this.data.stageOptions.map(name => ({ name, checked: stagePermissions.includes(name) })) })
  },

  addPermission() {
    const phoneNumber = this.data.phoneNumber
    if (phoneNumber.length < 5) {
      wx.showToast({ title: '请输入正确的手机号', icon: 'none' })
      return
    }
    if (this.data.role === 'staff' && !this.data.stagePermissions.length) {
      wx.showToast({ title: '至少选择一个赛段', icon: 'none' })
      return
    }
    this.setData({ busy: true })
    this.call('upsertPermission', {
      phoneNumber,
      label: this.data.label,
      role: this.data.role,
      stagePermissions: this.data.stagePermissions,
      entryPermissions: this.data.entryPermissions,
      enabled: true
    }).then(result => {
      this.setData({ phoneNumber: '', label: '' })
      this.applyPermissionLists(result.admins || [], result.staff || [])
      wx.showToast({ title: '已保存并启用', icon: 'success' })
    }).catch(error => {
      wx.showToast({ title: error.message || '保存失败', icon: 'none' })
    }).then(() => this.setData({ busy: false }))
  },

  togglePermission(e) {
    const { id, role, enabled } = e.currentTarget.dataset
    const currentEnabled = enabled === true || enabled === 'true'
    const nextEnabled = !currentEnabled
    this.setData({ busy: true })
    this.call('updatePermission', { id, role, enabled: nextEnabled }).then(result => {
      this.applyPermissionLists(result.admins || [], result.staff || [])
      wx.showToast({ title: nextEnabled ? '已启用' : '已停用', icon: 'success' })
    }).catch(error => {
      wx.showToast({ title: error.message || '更新失败', icon: 'none' })
    }).then(() => this.setData({ busy: false }))
  },

  removePermission(e) {
    const { id, role, phone } = e.currentTarget.dataset
    wx.showModal({
      title: '移除权限',
      content: '确定移除 ' + phone + ' 的权限吗？',
      confirmText: '移除',
      cancelText: '取消',
      success: result => {
        if (!result.confirm) return
        this.setData({ busy: true })
        this.call('deletePermission', { id, role }).then(data => {
          this.applyPermissionLists(data.admins || [], data.staff || [])
        }).catch(error => {
          wx.showToast({ title: error.message || '移除失败', icon: 'none' })
        }).then(() => this.setData({ busy: false }))
      }
    })
  }
})

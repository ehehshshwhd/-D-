const auth = require('../../utils/auth')

Page({
  data: { allowed: false, checking: true },
  onShow() {
    this.setData({ allowed: false, checking: true })
    auth.refreshRole().then(user => {
      const allowed = !!(user && user.isAdmin)
      this.setData({ allowed, checking: false, isAdmin: !!(user && user.isAdmin), isSuperAdmin: !!(user && user.isSuperAdmin) })
      if (!allowed) wx.showToast({ title: '无管理员权限', icon: 'none' })
    }).catch(() => {
      this.setData({ allowed: false, checking: false })
      wx.showToast({ title: '权限校验失败', icon: 'none' })
    })
  },
  placeholder(e) {
    wx.showToast({ title: e.currentTarget.dataset.label + '功能待接入', icon: 'none' })
  },
  openScoreReview() {
    if (!this.data.isAdmin) {
      wx.showToast({ title: '无管理员权限', icon: 'none' })
      return
    }
    wx.navigateTo({ url: '/pages/score-review/score-review' })
  },
  openPermissions() {
    if (!this.data.isAdmin) {
      wx.showToast({ title: '无管理员权限', icon: 'none' })
      return
    }
    wx.navigateTo({ url: '/pages/permissions/permissions' })
  }
})

const auth=require('../../utils/auth')
Page({
  data:{user:{nickname:'微信用户',avatarUrl:''},loggedIn:false,showLoginSheet:false,loading:false,error:''},
  onShow(){
    const user=auth.getUser()
    this.setData({user:user||{nickname:'微信用户',avatarUrl:''},loggedIn:!!user,showLoginSheet:!user,error:''})
    const bar=this.getTabBar&&this.getTabBar()
    if(bar)bar.setData({selected:3})
    if(user)auth.refreshRole().then(current=>this.setData({user:current,loggedIn:!!current})).catch(()=>{})
  },
  onProfileTap(){if(this.data.loggedIn)wx.showToast({title:'已登录',icon:'none'});else this.setData({showLoginSheet:true})},
  noop(){},
  closeLoginSheet(){this.setData({showLoginSheet:false,error:''})},
  openPrivacy(){wx.showModal({title:'隐私保护指引',content:'我们仅在你同意后，通过微信手机号授权完成身份验证，用于赛事报名及个人资料管理。',showCancel:false})},
  getPhoneNumber(e){
    const code=e&&e.detail&&e.detail.code
    if(!code){this.setData({error:'你取消了手机号授权'});return}
    this.setData({loading:true,error:''})
    auth.loginWithPhone(code).then(user=>this.setData({user,loggedIn:true,showLoginSheet:false})).catch(error=>this.setData({error:error&&error.message||'手机号登录失败，请重试'})).then(()=>this.setData({loading:false}))
  },
  openAdmin(){if(!this.data.user||!this.data.user.isAdmin){wx.showToast({title:'无管理员权限',icon:'none'});return}wx.navigateTo({url:'/pages/admin/admin'})},
  openMenu(e){if(!this.data.loggedIn){this.setData({showLoginSheet:true});return}wx.showToast({title:e.currentTarget.dataset.label+'功能待开通',icon:'none'})},
  logout(){auth.logout();this.setData({user:{nickname:'微信用户',avatarUrl:''},loggedIn:false,showLoginSheet:false});wx.showToast({title:'已退出登录',icon:'none'})}
})

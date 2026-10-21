const auth=require('../../utils/auth')
Page({
  data:{loading:false,error:''},
  fromProfile:false,
  onLoad(options){this.fromProfile=options&&options.from==='profile'},
  onShow(){if(auth.getUser()&&this.fromProfile)wx.navigateBack({delta:1})},
  onGetPhoneNumber(e){
    if(this.data.loading)return
    const code=e&&e.detail&&e.detail.code
    if(!code){this.setData({error:'你取消了手机号授权'});return}
    this.setData({loading:true,error:''})
    auth.loginWithPhone(code).then(()=>{
      if(this.fromProfile)wx.navigateBack({delta:1})
      else wx.switchTab({url:'/pages/profile/profile'})
    }).catch(error=>this.setData({error:error&&error.message||'手机号登录失败，请重试'})).then(()=>this.setData({loading:false}))
  },
  cancel(){if(getCurrentPages().length>1)wx.navigateBack({delta:1});else wx.switchTab({url:'/pages/events/events'})}
})

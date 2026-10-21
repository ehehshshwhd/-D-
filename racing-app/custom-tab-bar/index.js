Component({
  data:{selected:0,tabs:[['赛事','/pages/events/events','♛'],['工具','/pages/messages/messages','⌘'],['商城','/pages/products/products','▱'],['我的','/pages/profile/profile','●']],pressing:-1},
  methods:{
    touchStart(e){this.setData({pressing:+e.currentTarget.dataset.i})},
    touchEnd(){this.setData({pressing:-1})},
    switchTab(e){const i=+e.currentTarget.dataset.i;if(i===this.data.selected||!this.data.tabs[i]||this.switching)return;const previous=this.data.selected;this.switching=true;this.setData({selected:i,pressing:-1});wx.switchTab({url:this.data.tabs[i][1],fail:()=>{this.setData({selected:previous});wx.showToast({title:'切换失败，请重试',icon:'none'})},complete:()=>{this.switching=false}})}
  }
})

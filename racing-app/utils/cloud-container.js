const config=require('../config/cloud')

let initialized=false

function init(){
  if(initialized||!wx.cloud)return
  wx.cloud.init({env:config.env})
  initialized=true
}

function call(path,options={}){
  init()
  if(!wx.cloud||typeof wx.cloud.callContainer!=='function')return Promise.reject(new Error('当前基础库不支持 wx.cloud.callContainer'))
  const method=String(options.method||'GET').toUpperCase()
  return wx.cloud.callContainer({
    config:{env:config.env},path,method,
    header:{'X-WX-SERVICE':config.serviceName,'Content-Type':'application/json',...(options.header||{})},
    data:options.data,dataType:options.dataType||'json'
  }).then(result=>{
    const statusCode=result&&result.statusCode
    if(statusCode&&statusCode>=400)throw new Error(result.data&&result.data.message||`云托管请求失败（${statusCode}）`)
    return result
  })
}

module.exports={init,call}

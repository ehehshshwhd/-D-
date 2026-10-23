const crypto=require('crypto')
const fields={姓名:80,赛号:12,车队:100,车型:80,排量:40,颜色:40,身份证:24,手机号:20,血型:10,国籍:80,领航员姓名:80,领航员身份证:24,领航员手机号:20,领航员血型:10,领航员国籍:80}

function createRegistrationService({db,ensureCollection,getStoredUser}){
  async function read(collection,id){
    try{const result=await collection.doc(id).get();return result&&result.data||null}
    catch(error){if(/document.*(not found|not exist|不存在)/i.test(error.message||error.errMsg||''))return null;throw error}
  }
  function requireOpen(event,submitting){
    if(!event||event.published!==true||event.deleted||event.deletedAt)throw new Error('赛事未发布或已下架')
    if(event.registrationEnabled!==true)throw new Error('本赛事暂未开启报名')
    const deadline=String(event.registrationDeadline||'').slice(0,10).replace(/\//g,'-')
    if(submitting&&/^\d{4}-\d{2}-\d{2}$/.test(deadline)&&Date.now()>Date.parse(deadline+'T23:59:59.999+08:00'))throw new Error('本赛事报名已截止')
  }
  return async function handle(request,openid){
    if(!openid)throw new Error('请先登录微信账户')
    const eventId=String(request.eventId||'').trim()
    if(!/^[A-Za-z0-9_-]{1,80}$/.test(eventId))throw new Error('赛事 ID 无效')
    const found=await db.collection('events').where({id:eventId}).limit(2).get()
    if(!found.data||found.data.length!==1)throw new Error('未找到唯一的已发布赛事')
    const event=found.data[0]
    const submitting=request.action==='submitRegistration'
    requireOpen(event,submitting)
    await ensureCollection('event_management_data')
    const key='signup-'+eventId
    const documentId='ed_'+crypto.createHash('sha256').update(eventId+'::'+key).digest('hex').slice(0,40)
    if(!submitting){
      const record=await read(db.collection('event_management_data'),documentId)
      const rows=record&&Array.isArray(record.value)?record.value:[]
      if(request.action==='getRegistrationProfiles')return {eventId,profiles:rows.filter(row=>row&&row.submittedBy===openid).map(row=>Object.fromEntries(Object.keys(fields).map(key=>[key,String(row[key]||'')])))}
      return {eventId,rows:rows.filter(Boolean).map(row=>({id:row.id,组别:row.组别,赛号:row.赛号,姓名:row.姓名,车队:row.车队,领航员姓名:row.领航员姓名||''}))}
    }
    const user=await getStoredUser(openid)
    if(!user||!user.phoneNumber)throw new Error('请先完成手机号授权登录后报名')
    if(!/^[A-Za-z0-9_-]{8,80}$/.test(String(request.requestId||'')))throw new Error('报名请求标识无效，请重新打开报名表')
    const form=request.form&&typeof request.form==='object'&&!Array.isArray(request.form)?request.form:{}
    const row={}
    for(const [name,max]of Object.entries(fields)){
      const value=String(form[name]??'').trim()
      if(value.length>max)throw new Error(name+'超出长度限制')
      row[name]=value
    }
    if(!row.姓名)throw new Error('请填写车手姓名')
    if(!/^[A-Za-z0-9]{1,12}$/.test(row.赛号))throw new Error('赛号必须是 1 到 12 位字母或数字')
    row.赛号=row.赛号.toUpperCase()
    if(!/^1\d{10}$/.test(row.手机号))throw new Error('请填写正确的车手手机号')
    if(row.领航员手机号&&!/^1\d{10}$/.test(row.领航员手机号))throw new Error('请填写正确的领航员手机号')
    const rowId='signup_'+crypto.createHash('sha256').update(eventId+'::'+openid+'::'+request.requestId).digest('hex').slice(0,40)
    let result
    if(typeof db.runTransaction!=='function')throw new Error('报名云端事务不可用，请稍后重试')
    await db.runTransaction(async transaction=>{
      // Check the switch inside the transaction so disabling registration wins over an in-flight form.
      const currentEvent=await read(transaction.collection('events'),event._id)
      requireOpen(currentEvent,true)
      const option=(currentEvent.signupOptions||[]).find(item=>item&&String(item.name||'')===String(form.组别||'')&&item.registrationEnabled!==false)
      if(!option)throw new Error('该组别暂未开放报名，请重新选择组别')
      const collection=transaction.collection('event_management_data')
      const previous=await read(collection,documentId)
      if(previous&&(!Array.isArray(previous.value)||!Number.isSafeInteger(previous.revision)||previous.revision<0))throw new Error('报名数据或版本异常，请联系管理员')
      const rows=previous?previous.value:[]
      if(rows.some(item=>item&&item.id===rowId)){result={eventId,id:rowId,revision:previous.revision};return}
      const groupRows=rows.filter(item=>item&&item.组别===option.name)
      const carKey=value=>String(value||'').trim().toUpperCase().replace(/^0+(?=\d)/,'')
      if(groupRows.some(item=>carKey(item.赛号)===carKey(row.赛号)))throw new Error('该组别赛号已被使用，请更换赛号')
      const quota=Number(option.quota)
      if(Number.isFinite(quota)&&quota>0&&groupRows.length>=quota)throw new Error('该组别报名人数已达到上限')
      if(option.navigatorRequired===true&&!row.领航员姓名)throw new Error('该组别需要填写领航员姓名')
      const now=new Date()
      const saved={...row,id:rowId,组别:option.name,重量:0,发车顺序:groupRows.length+1,支付:'未支付',金额:String(option.fee||'0'),submittedBy:openid,来源:'小程序',报名时间:now.toISOString()}
      const value=[...rows,saved]
      if(Buffer.byteLength(JSON.stringify(value),'utf8')>700*1024)throw new Error('该赛事报名数据已达存储上限，请联系管理员')
      const revision=(previous?previous.revision:0)+1
      const data={eventId,key,value,revision,updatedAt:now,createdAt:previous&&previous.createdAt||now}
      await collection.doc(documentId).set({data})
      const confirmed=await read(collection,documentId)
      if(!confirmed||confirmed.revision!==revision||!Array.isArray(confirmed.value)||!confirmed.value.some(item=>item.id===rowId))throw new Error('报名保存后回读失败，请重试；不会重复报名')
      result={eventId,id:rowId,revision}
    })
    return result
  }
}
module.exports={createRegistrationService}

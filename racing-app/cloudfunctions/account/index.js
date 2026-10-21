const cloud=require('wx-server-sdk')
const crypto=require('crypto')

cloud.init({env:cloud.DYNAMIC_CURRENT_ENV})
const db=cloud.database()
const SUPER_ADMIN_PHONE='13729912574'
const STAGES=Array.from({length:20},(_,index)=>`SS${index+1}`)
const ENTRY_PERMISSION_KEYS=['startTime','endTime','penalty']
const WORK_RECORD_LIMIT=1000
const collectionReady=new Map()

function validateEventId(value){
  if(typeof value!=='string')throw new Error('赛事 ID 必须是 1 到 80 位字母、数字、下划线或连字符')
  const eventId=value.trim()
  if(!eventId||eventId.length>80||!/^[A-Za-z0-9_-]+$/.test(eventId))throw new Error('赛事 ID 必须是 1 到 80 位字母、数字、下划线或连字符')
  return eventId
}

function stableStringify(value){
  if(Array.isArray(value))return `[${value.map(stableStringify).join(',')}]`
  if(value&&typeof value==='object')return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}

// 权限集合由云函数按需初始化，避免首次打开权限管理页因集合尚未创建而报 -502005。
async function ensureCollection(name){
  if(collectionReady.has(name))return collectionReady.get(name)
  const check=(async()=>{
    try{
      await db.collection(name).limit(1).get()
      return
    }catch(error){
      const message=String(error&&(error.errMsg||error.message)||'')
      if(!message.includes('-502005')&&!/collection.*(not exist|doesn't exist|不存在)/i.test(message))throw error
    }
    try{
      await db.createCollection(name)
    }catch(error){
      // 并发请求可能由另一个实例先完成创建；再次读取确认即可。
      try{
        await db.collection(name).limit(1).get()
      }catch{
        throw error
      }
    }
  })().catch(error=>{
    // 只缓存已成功的检查；网络或权限临时错误后允许下一次请求重试。
    collectionReady.delete(name)
    throw error
  })
  collectionReady.set(name,check)
  return check
}

function normalizePhone(value){
  return String(value||'').replace(/\D/g,'')
}

function normalizeStages(value){
  if(!Array.isArray(value))return STAGES.slice()
  const result=[]
  value.forEach(stage=>{
    const normalized=String(stage||'').toUpperCase()
    if(STAGES.includes(normalized)&&!result.includes(normalized))result.push(normalized)
  })
  return result
}

function normalizeEntryPermissions(value){
  const source=value&&typeof value==='object'?value:{}
  return ENTRY_PERMISSION_KEYS.reduce((result,key)=>{
    // 老账号没有该字段时默认保留原有录入能力；只有明确保存为 false 才关闭。
    result[key]=source[key]!==false
    return result
  },{})
}

async function resolveRole(phoneInfo){
  const phoneNumber=normalizePhone(phoneInfo&&(phoneInfo.purePhoneNumber||phoneInfo.phoneNumber))
  const countryCode=String((phoneInfo&&phoneInfo.countryCode)||'86')
  if(!phoneNumber)return {role:'user',isAdmin:false,isSuperAdmin:false,isStaff:false,entryPermissions:normalizeEntryPermissions()}
  // 最高管理员不依赖名单集合，确保云端权限集合暂时不可用时仍可登录管理。
  if(phoneNumber===SUPER_ADMIN_PHONE||phoneNumber==='86'+SUPER_ADMIN_PHONE)return {role:'superadmin',isAdmin:true,isSuperAdmin:true,isStaff:true,stagePermissions:STAGES.slice(),entryPermissions:normalizeEntryPermissions()}
  try{
    const [adminLookup,staffLookup]=await Promise.allSettled([
      db.collection('admin_users').where({phoneNumber,countryCode,enabled:true}).limit(1).get(),
      db.collection('staff_users').where({phoneNumber,countryCode,enabled:true}).limit(1).get()
    ])
    if(adminLookup.status==='rejected')throw adminLookup.reason
    const adminResult=adminLookup.value
    const isAdmin=!!(adminResult.data&&adminResult.data.length)
    if(isAdmin)return {role:'admin',isAdmin:true,isSuperAdmin:false,isStaff:true,stagePermissions:STAGES.slice(),entryPermissions:normalizeEntryPermissions()}
    if(staffLookup.status==='rejected')throw staffLookup.reason
    const staffResult=staffLookup.value
    const staff=staffResult.data&&staffResult.data[0]
    const isStaff=!!staff
    return {role:isStaff?'staff':'user',isAdmin:false,isSuperAdmin:false,isStaff,stagePermissions:isStaff?normalizeStages(staff.stagePermissions):[],entryPermissions:isStaff?normalizeEntryPermissions(staff.entryPermissions):normalizeEntryPermissions()}
  }catch(error){
    // 权限名单集合尚未创建时，安全地按普通用户处理。
    console.warn('role collections are not ready',error)
    return {role:'user',isAdmin:false,isSuperAdmin:false,isStaff:false,stagePermissions:[],entryPermissions:normalizeEntryPermissions()}
  }
}

async function getStoredUser(openid){
  try{
    const result=await db.collection('users').where({openid}).limit(1).get()
    return result.data&&result.data[0]||null
  }catch(error){
    console.warn('users collection is not ready',error)
    return null
  }
}

async function requireSuperAdmin(openid){
  const stored=await getStoredUser(openid)
  const phone=normalizePhone(stored&&stored.phoneNumber)
  if(phone!==SUPER_ADMIN_PHONE&&phone!=='86'+SUPER_ADMIN_PHONE)throw new Error('仅最高管理员可调整权限')
  return stored
}

async function requireAdmin(openid){
  const stored=await getStoredUser(openid)
  const phone=normalizePhone(stored&&stored.phoneNumber)
  if(phone===SUPER_ADMIN_PHONE||phone==='86'+SUPER_ADMIN_PHONE)return stored
  const access=stored&&stored.phoneNumber?await resolveRole({phoneNumber:stored.phoneNumber,countryCode:stored.countryCode||'86'}):null
  if(!access||!access.isAdmin)throw new Error('仅管理员可查看权限')
  return stored
}

function permissionView(item,role){
  return {id:item._id,phoneNumber:item.phoneNumber,countryCode:item.countryCode||'86',label:item.label||'',enabled:item.enabled!==false,role,stagePermissions:normalizeStages(item.stagePermissions),entryPermissions:normalizeEntryPermissions(item.entryPermissions)}
}

async function listPermissions(){
  await Promise.all([ensureCollection('admin_users'),ensureCollection('staff_users')])
  const [admins,staff]=await Promise.all([
    db.collection('admin_users').orderBy('createdAt','desc').get(),
    db.collection('staff_users').orderBy('createdAt','desc').get()
  ])
  return {
    admins:(admins.data||[]).map(item=>permissionView(item,'admin')),
    staff:(staff.data||[]).map(item=>permissionView(item,'staff'))
  }
}

async function permissionRows(collection,phoneNumber,countryCode){
  const result=await db.collection(collection).where({phoneNumber,countryCode}).get()
  return result.data||[]
}

function normalizeWorkStage(value){
  const stage=String(value||'').toUpperCase()
  if(!STAGES.includes(stage))throw new Error('无效的赛段')
  return stage
}

async function requireWorkAccess(openid){
  const stored=await getStoredUser(openid)
  if(!stored||!stored.phoneNumber)throw new Error('请先登录工作人员账户')
  const access=await resolveRole({phoneNumber:stored.phoneNumber,countryCode:stored.countryCode||'86'})
  if(!access.isStaff&&!access.isAdmin)throw new Error('当前账户没有工作权限')
  return access
}

function sanitizeWorkRows(rows,previousRows){
  if(!Array.isArray(rows))throw new Error('成绩列表格式无效')
  if(rows.length>WORK_RECORD_LIMIT)throw new Error(`每个赛段最多保存 ${WORK_RECORD_LIMIT} 条成绩`)
  const previousByCar=new Map((Array.isArray(previousRows)?previousRows:[]).map(item=>[String(item&&item.carNumber||'').replace(/[^0-9a-z]/gi,'').toUpperCase(),item]))
  const seenCars=new Set()
  const result=rows.map((row,index)=>{
    if(!row||typeof row!=='object'||Array.isArray(row))throw new Error(`第 ${index+1} 条成绩格式无效`)
    const rawCarNumber=String(row.carNumber||'')
    const carNumber=rawCarNumber.replace(/[^0-9a-z]/gi,'').toUpperCase()
    if(!carNumber)throw new Error(`第 ${index+1} 条成绩没有有效车号`)
    if(carNumber.length>12)throw new Error(`第 ${index+1} 条成绩车号超过 12 位`)
    if(seenCars.has(carNumber))throw new Error(`车号 ${carNumber} 重复，请检查后重试`)
    seenCars.add(carNumber)
    for(const [field,max] of Object.entries({id:80,group:100,groupName:100,teamName:100,driver:80,name:80,stage1:24,stage2:24,stage3:24,validScore:24,importedStage:24,startTime:24,endTime:24,penaltyTotal:16,segmentDuration:24,totalDuration:24,uploader:80,uploadedAt:80,note:500})){
      if(row[field]!=null&&String(row[field]).length>max)throw new Error(`第 ${index+1} 条成绩的 ${field} 超出长度限制`)
    }
    if(row.penaltyInputs!=null&&!Array.isArray(row.penaltyInputs))throw new Error(`第 ${index+1} 条成绩罚时格式无效`)
    if(Array.isArray(row.penaltyInputs)&&row.penaltyInputs.length>10)throw new Error(`第 ${index+1} 条成绩罚时项目超过 10 项`)
    const penaltyInputs=Array.isArray(row.penaltyInputs)?row.penaltyInputs.map((item,penaltyIndex)=>{
      if(!item||typeof item!=='object'||Array.isArray(item))throw new Error(`第 ${index+1} 条成绩第 ${penaltyIndex+1} 项罚时格式无效`)
      const id=String(item.id||('penalty_'+penaltyIndex)),value=String(item.value||'')
      if(id.length>80||value.length>12)throw new Error(`第 ${index+1} 条成绩第 ${penaltyIndex+1} 项罚时超出长度限制`)
      return {...item,id,value}
    }):[]
    // Keep event-specific row metadata intact. Strip CloudBase and record-level
    // fields so a client cannot smuggle a new revision or overwrite another
    // event/stage through an individual result row.
    const custom={...row}
    ;['_id','_openid','openid','eventId','stage','revision','createdAt','updatedAt','updatedBy','updatedByPhone','updatedByRole'].forEach(key=>delete custom[key])
    const previous=previousByCar.get(carNumber)||{}
    const startTime=String(row.startTime||'')
    const endTime=String(row.endTime||'')
    const penaltyTotal=String(row.penaltyTotal||'')
    const segmentDuration=String(row.segmentDuration||'')
    const totalDuration=String(row.totalDuration||'')
    const sameTiming=startTime===String(previous.startTime||'')
      &&endTime===String(previous.endTime||'')
      &&penaltyTotal===String(previous.penaltyTotal||'')
      &&segmentDuration===String(previous.segmentDuration||'')
      &&totalDuration===String(previous.totalDuration||'')
    const status=String(row&&row.status||'').toLowerCase()
    const previousStatus=String(previous.status||'').toLowerCase()
    return {
      ...custom,
      id:String(row.id||('car_'+index)),
      carNumber,
      group:String(row.group||row.groupName||row.teamName||previous.group||previous.groupName||previous.teamName||'').trim(),
      teamName:String(row.teamName||row.groupName||row.group||previous.teamName||previous.groupName||previous.group||'').trim(),
      driver:String(row.driver||row.name||previous.driver||''),
      stage1:String(row.stage1||''),
      stage2:String(row.stage2||''),
      stage3:String(row.stage3||''),
      validScore:String(row.validScore||''),
      imported:row.imported===true,
      importedStage:String(row.importedStage||''),
      uploader:String(row.uploader||''),
      uploadedAt:String(row.uploadedAt||''),
      startTime,
      endTime,
      penaltyInputs,
      penaltyTotal,
      segmentDuration,
      totalDuration,
      durationManual:row.durationManual===true,
      status:['approved','returned','pending'].includes(status)?status:(sameTiming&&['approved','returned','pending'].includes(previousStatus)?previousStatus:'pending'),
      note:String(row.note||(sameTiming&&previous.note)||'').trim()
    }
  })
  let serialized
  try{serialized=JSON.stringify(result)}catch{throw new Error('成绩包含无法保存的数据格式')}
  if(Buffer.byteLength(serialized,'utf8')>700*1024)throw new Error('当前赛段成绩超过 CloudBase 单文档安全大小，请减少内容后重试')
  return result
}

function workRevision(record){
  const revision=Number(record&&record.revision)
  return Number.isSafeInteger(revision)&&revision>=0?revision:0
}

function expectedWorkRevision(value){
  if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0||value>=Number.MAX_SAFE_INTEGER)throw new Error('成绩版本无效，请刷新赛段后重试')
  return value
}

function workRecordDocumentId(eventId,stage){
  const crypto=require('crypto')
  return `work_${crypto.createHash('sha256').update(`${eventId}::${stage}`).digest('hex').slice(0,40)}`
}

function isMissingWorkDocument(error){
  const code=String(error&&error.errCode||'').toLowerCase()
  const message=String(error&&(error.errMsg||error.message)||'').toLowerCase()
  return /not.?found|not exist|does not exist|不存在/.test(message)||code==='-1'||code.includes('not_found')
}

async function transactionDocument(collection,id){
  try{
    const result=await collection.doc(id).get()
    return result&&result.data&&typeof result.data==='object'?result.data:null
  }catch(error){
    if(isMissingWorkDocument(error))return null
    throw error
  }
}

async function findWorkRecord(eventId,stage){
  const result=await db.collection('work_records').where({eventId,stage}).limit(2).get()
  if(result.data&&result.data.length>1)throw new Error(`云端成绩记录重复：${eventId}/${stage}；请先清理重复记录`)
  return result.data&&result.data[0]||null
}

function copyWorkMetadata(record){
  const data=record&&typeof record==='object'?{...record}:{}
  ;['_id','_openid','openid','eventId','stage','rows','revision','createdAt','updatedAt','updatedBy','updatedByPhone','updatedByRole'].forEach(key=>delete data[key])
  return data
}

function protectWorkEntryFields(rows,previousRows,access){
  if(access.isAdmin)return rows
  const permissions=normalizeEntryPermissions(access.entryPermissions)
  if(ENTRY_PERMISSION_KEYS.every(key=>permissions[key]))return rows
  const previousByCar=new Map((previousRows||[]).map(row=>[String(row.carNumber||'').toUpperCase(),row]))
  const clock=value=>{
    const match=String(value||'').match(/^(\d{1,2}):(\d{2}):(\d{1,2})(?:\.(\d{1,3}))?$/)
    if(!match||Number(match[1])>23||Number(match[2])>59||Number(match[3])>59)return null
    return (Number(match[1])*3600+Number(match[2])*60+Number(match[3]))*1000+Number((match[4]||'').padEnd(3,'0'))
  }
  const penalty=value=>{
    const text=String(value||'').trim()
    if(/^\d+$/.test(text))return Number(text)*1000
    const units=text.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/i)
    return units?(Number(units[1]||0)*3600+Number(units[2]||0)*60+Number(units[3]||0))*1000:clock(text)||0
  }
  const duration=value=>`${Math.floor(value/3600000)}:${String(Math.floor(value%3600000/60000)).padStart(2,'0')}:${String(Math.floor(value%60000/1000)).padStart(2,'0')}.${String(value%1000).padStart(3,'0')}`
  return rows.map(row=>{
    const previous=previousByCar.get(row.carNumber)||{}
    const result={...row}
    for(const [permission,fields] of Object.entries({startTime:['startTime','start'],endTime:['endTime','finish'],penalty:['penaltyTotal','penalty']})){
      if(permissions[permission])continue
      const value=String(previous[fields[0]]||previous[fields[1]]||'')
      result[fields[0]]=value
      if(Object.prototype.hasOwnProperty.call(result,fields[1]))result[fields[1]]=value
    }
    if(!permissions.penalty)result.penaltyInputs=Array.isArray(previous.penaltyInputs)?previous.penaltyInputs:[]
    // Derived totals must not provide a route around a disabled entry field.
    // Keep an existing imported/manual result authoritative; otherwise derive
    // times from the permitted values after restoring protected fields.
    result.durationManual=previous.durationManual===true
    const start=clock(result.startTime),end=clock(result.endTime)
    if(!result.durationManual&&start!==null&&end!==null){
      const elapsed=(end-start+86400000)%86400000
      result.segmentDuration=duration(elapsed)
      result.totalDuration=duration(elapsed+penalty(result.penaltyTotal))
    }else{
      result.segmentDuration=String(previous.segmentDuration||'')
      result.totalDuration=String(previous.totalDuration||'')
    }
    if(Object.prototype.hasOwnProperty.call(result,'duration'))result.duration=result.totalDuration
    return result
  })
}

async function saveWorkRecordsAtomic({eventId,records,openid,access}){
  eventId=validateEventId(eventId)
  if(typeof db.runTransaction!=='function')throw new Error('云数据库事务不可用，未写入成绩；请检查云函数 SDK 后重试')
  const stored=await getStoredUser(openid)
  const now=new Date()
  const prepared=[]
  for(const requested of records){
    const expectedRevision=expectedWorkRevision(requested&&requested.expectedRevision)
    const stage=normalizeWorkStage(requested&&requested.stage)
    const current=await findWorkRecord(eventId,stage)
    prepared.push({...requested,stage,expectedRevision,current,recordId:String(current&&current._id||workRecordDocumentId(eventId,stage))})
  }
  const confirmedRecords=[]
  await db.runTransaction(async transaction=>{
    confirmedRecords.length=0
    const collection=transaction.collection('work_records')
    const writes=[]
    for(const requested of prepared){
      const {stage,expectedRevision,rows,recordId}=requested
      const current=await transactionDocument(collection,recordId)
      const actualRevision=workRevision(current)
      if(actualRevision!==expectedRevision)throw new Error(`成绩已被其他设备修改（${stage} 云端版本 ${actualRevision}，本地版本 ${expectedRevision}），请刷新后重新编辑；本次未覆盖云端数据`)
      const previousRows=current&&current.rows||[]
      const sanitized=protectWorkEntryFields(sanitizeWorkRows(rows,previousRows),previousRows,access)
      const revision=expectedRevision+1
      const data={...copyWorkMetadata(current),eventId,stage,rows:sanitized,revision,updatedAt:now,updatedBy:openid,updatedByPhone:normalizePhone(stored&&stored.phoneNumber),updatedByRole:access.role||'staff'}
      if(current)await collection.doc(recordId).update({data})
      else await collection.doc(recordId).set({data:{...data,createdAt:now}})
      writes.push({stage,rows:sanitized,revision,recordId})
    }
    for(const write of writes){
      const confirmed=await transactionDocument(collection,write.recordId)
      if(!confirmed||workRevision(confirmed)!==write.revision||stableStringify(confirmed.rows)!==stableStringify(write.rows))throw new Error(`${write.stage} 成绩写入后回读核对失败，请刷新核对云端后再操作`)
      confirmedRecords.push({stage:write.stage,rows:write.rows,revision:write.revision,updatedAt:confirmed.updatedAt||now})
    }
  })
  return confirmedRecords
}

async function getWorkRecords(event,openid){
  const eventId=validateEventId(event&&event.eventId)
  const access=await requireWorkAccess(openid)
  const stage=normalizeWorkStage(event.stage)
  if(!access.isAdmin&&!access.stagePermissions.includes(stage))throw new Error('当前账户没有该赛段权限')
  await ensureCollection('work_records')
  let record=await findWorkRecord(eventId,stage)
  // 兼容旧版本按工作人员 openid 保存的记录。共享表首次为空时，迁移当前账号的旧数据。
  if(!record){
    const legacy=await db.collection('work_records').where({openid,eventId,stage}).limit(2).get()
    if(legacy.data&&legacy.data.length>1)throw new Error(`旧版云端成绩记录重复：${eventId}/${stage}；请先清理重复记录`)
    const legacyRecord=legacy.data&&legacy.data[0]
    if(legacyRecord){
      const stored=await getStoredUser(openid)
      const now=new Date()
      const migrated={...copyWorkMetadata(legacyRecord),eventId,stage,rows:legacyRecord.rows||[],revision:1,updatedAt:now,updatedBy:openid,updatedByPhone:normalizePhone(stored&&stored.phoneNumber),updatedByRole:access.role||'staff',migratedFrom:legacyRecord._id}
      if(typeof db.runTransaction!=='function') throw new Error('云数据库事务不可用，未迁移历史成绩；请稍后重试')
      await db.runTransaction(async transaction=>{
        const collection=transaction.collection('work_records')
        const id=workRecordDocumentId(eventId,stage)
        const existing=await transactionDocument(collection,id)
        if(existing){record={...existing,_id:id};return}
        await collection.doc(id).set({data:migrated})
        const saved=await transactionDocument(collection,id)
        if(!saved)throw new Error('历史成绩迁移后回读失败，请稍后重试')
        record={...saved,_id:id}
      })
    }
  }
  const rows=record?sanitizeWorkRows(record.rows,[]):[]
  return {rows, count:rows.length, revision:workRevision(record),updatedAt:record&&record.updatedAt||null,updatedByPhone:record&&record.updatedByPhone||'',entryPermissions:access.entryPermissions}
}

async function saveWorkRecords(event,openid){
  const eventId=validateEventId(event&&event.eventId)
  const access=await requireWorkAccess(openid)
  const stage=normalizeWorkStage(event.stage)
  if(!access.isAdmin&&!access.stagePermissions.includes(stage))throw new Error('当前账户没有该赛段权限')
  await ensureCollection('work_records')
  const expectedRevision=expectedWorkRevision(event.expectedRevision)
  const rows=sanitizeWorkRows(event.rows,[])
  const [saved]=await saveWorkRecordsAtomic({eventId,records:[{stage,expectedRevision,rows}],openid,access})
  return {saved:true,count:rows.length,revision:saved.revision,updatedAt:saved.updatedAt,entryPermissions:access.entryPermissions}
}

async function uploadAllWorkRecords(event,openid){
  const eventId=validateEventId(event&&event.eventId)
  const access=await requireWorkAccess(openid)
  const requestedRecords=event.records
  if(!Array.isArray(requestedRecords)||!requestedRecords.length)throw new Error('没有可上传的成绩')
  const requestedStages=[]
  for(const [index,item] of requestedRecords.entries()){
    if(!item||typeof item!=='object'||Array.isArray(item))throw new Error(`第 ${index+1} 个赛段记录格式无效`)
    const stage=normalizeWorkStage(item.stage)
    if(requestedStages.includes(stage))throw new Error(`赛段 ${stage} 重复，请重试`)
    if(!Array.isArray(item.rows))throw new Error(`赛段 ${stage} 成绩列表格式无效`)
    if(item.rows.length>WORK_RECORD_LIMIT)throw new Error(`赛段 ${stage} 超过 ${WORK_RECORD_LIMIT} 条成绩`)
    item.expectedRevision=expectedWorkRevision(item.expectedRevision)
    requestedStages.push(stage)
  }
  if(!access.isAdmin){
    const denied=requestedStages.filter(stage=>!access.stagePermissions.includes(stage))
    if(denied.length)throw new Error(`没有 ${denied.join('、')} 权限；本次未开始上传任何赛段`)
  }
  // Validate every payload before the first database write. Otherwise a bad
  // later stage could leave an apparently failed batch partially committed.
  for(const item of requestedRecords)sanitizeWorkRows(item.rows,[])
  const stages=requestedStages
  await ensureCollection('work_records')
  const submittedRecords=requestedStages.map(stage=>{
    const submitted=requestedRecords.find(item=>String(item.stage||'').toUpperCase()===stage)
    return {stage,expectedRevision:submitted.expectedRevision,rows:sanitizeWorkRows(submitted.rows,[])}
  })
  const records=await saveWorkRecordsAtomic({eventId,records:submittedRecords,openid,access})
  if(!records.length)throw new Error('没有可上传的成绩')
  if(records.length!==requestedStages.length)throw new Error(`只处理了 ${records.length}/${requestedStages.length} 个赛段，请刷新核对后重试`)
  const stored=await getStoredUser(openid)
  const uploaderPhone=normalizePhone(stored&&stored.phoneNumber)
  const uploadedAt=new Date()
  const stageCount=records.length,rowCount=records.reduce((sum,item)=>sum+item.rows.length,0)
  let uploadLogSaved=true
  try{
    await ensureCollection('work_uploads')
    await db.collection('work_uploads').add({data:{eventId,openid,uploaderPhone,countryCode:stored&&stored.countryCode||'86',role:access.role||'staff',records:records.map(item=>({stage:item.stage,rowCount:item.rows.length})),stageCount,rowCount,uploadedAt}})
  }catch(error){
    uploadLogSaved=false
    console.error('成绩已写入但上传审计日志写入失败',error)
  }
  return {uploaded:true,stageCount,rowCount,uploadedAt,uploadLogSaved,records:records.map(item=>({stage:item.stage,revision:item.revision}))}
}

function reviewRowView(stage,row,index){
  const status=String(row&&row.status||'').toLowerCase()
  return {
    id:`${stage}:${String(row&&row.id||row&&row.carNumber||index)}`,
    stage,
    carNumber:String(row&&row.carNumber||''),
    status:status==='approved'?'passed':status==='returned'?'returned':'pending',
    statusLabel:status==='approved'?'已通过':status==='returned'?'已退回':'待审核',
    duration:String(row&&row.segmentDuration||row&&row.totalDuration||''),
    startTime:String(row&&row.startTime||''),
    endTime:String(row&&row.endTime||''),
    penalty:String(row&&row.penaltyTotal||''),
    uploader:String(row&&row.uploader||'')
  }
}

async function listReviewRecords(event,openid){
  await requireAdmin(openid)
  const eventId=validateEventId(event&&event.eventId)
  await ensureCollection('work_records')
  const result=await db.collection('work_records').where({eventId}).limit(STAGES.length+1).get()
  const records=result.data||[]
  if(records.length>STAGES.length)throw new Error('当前赛事存在重复或异常成绩记录，请先检查云端数据')
  const rows=[]
  records.forEach(record=>{
    const stage=normalizeWorkStage(record.stage)
    sanitizeWorkRows(record.rows||[],[]).forEach((row,index)=>rows.push(reviewRowView(stage,row,index)))
  })
  rows.sort((left,right)=>STAGES.indexOf(left.stage)-STAGES.indexOf(right.stage)||String(left.carNumber).localeCompare(String(right.carNumber),'zh-CN',{numeric:true}))
  return {eventId,records:rows,count:rows.length}
}

async function approveAllScores(event,openid){
  const operator=await requireAdmin(openid)
  const eventId=validateEventId(event&&event.eventId)
  await ensureCollection('work_records')
  const result=await db.collection('work_records').where({eventId}).limit(STAGES.length+1).get()
  const records=result.data||[]
  if(records.length>STAGES.length)throw new Error('当前赛事存在重复或异常成绩记录，请先检查云端数据')
  if(!records.length)return {eventId,approvedCount:0,stageCount:0}
  if(typeof db.runTransaction!=='function')throw new Error('云数据库事务不可用，未审核成绩；请稍后重试')
  const now=new Date()
  const stored=await getStoredUser(openid)
  const operatorPhone=normalizePhone(stored&&stored.phoneNumber)
  let approvedCount=0
  const approvedStages=[]
  await db.runTransaction(async transaction=>{
    const collection=transaction.collection('work_records')
    approvedCount=0
    approvedStages.length=0
    for(const record of records){
      const recordId=String(record._id||workRecordDocumentId(eventId,normalizeWorkStage(record.stage)))
      const current=await transactionDocument(collection,recordId)
      if(!current)continue
      const stage=normalizeWorkStage(current.stage||record.stage)
      const rows=sanitizeWorkRows(current.rows||[],[]).map(row=>({...row,status:'approved'}))
      const revision=workRevision(current)+1
      const data={...copyWorkMetadata(current),eventId,stage,rows,revision,updatedAt:now,updatedBy:openid,updatedByPhone:operatorPhone,updatedByRole:'admin',publishedAt:now,publishedBy:openid,publishedByPhone:operatorPhone,publishedByRole:operator&&operator.role||'admin'}
      await collection.doc(recordId).update({data})
      approvedCount+=rows.length
      approvedStages.push(stage)
    }
  })
  return {eventId,approvedCount,stageCount:approvedStages.length,stages:approvedStages}
}

async function upsertPermission(event,openid){
  const operator=await requireAdmin(openid)
  const role=event.role==='admin'?'admin':'staff'
  const phoneNumber=normalizePhone(event.phoneNumber)
  const countryCode=String(event.countryCode||'86')
  if(phoneNumber.length<5||phoneNumber.length>15)throw new Error('请输入正确的手机号')
  const operatorPhone=normalizePhone(operator&&operator.phoneNumber)
  const operatorIsSuper=operatorPhone===SUPER_ADMIN_PHONE||operatorPhone==='86'+SUPER_ADMIN_PHONE
  if(role==='admin'&&!operatorIsSuper)throw new Error('普通管理员不能修改管理员账号')
  if(role==='staff'&&!operatorIsSuper){
    const existingAdmin=await permissionRows('admin_users',phoneNumber,countryCode)
    if(existingAdmin.length)throw new Error('普通管理员不能修改管理员账号')
  }
  if(phoneNumber===SUPER_ADMIN_PHONE||phoneNumber==='86'+SUPER_ADMIN_PHONE){
    if(role!=='admin')throw new Error('最高管理员不能改为工作人员')
    // 最高管理员固定拥有全部权限，不能通过普通账号表单修改或停用。
    return listPermissions()
  }
  const collection=role==='admin'?'admin_users':'staff_users'
  const otherCollection=role==='admin'?'staff_users':'admin_users'
  const stagePermissions=normalizeStages(event.stagePermissions)
  if(role==='staff'&&stagePermissions.length===0)throw new Error('工作人员至少需要一个赛段权限')
  const entryPermissions=role==='admin'?normalizeEntryPermissions():normalizeEntryPermissions(event.entryPermissions)
  // 通过“添加/保存权限”提交的账号始终立即启用；停用只能由账号列表中的独立开关执行。
  const data={phoneNumber,countryCode,label:String(event.label||'').trim().slice(0,30),enabled:true,stagePermissions,entryPermissions,updatedAt:new Date()}
  const existing=await permissionRows(collection,phoneNumber,countryCode)
  if(existing.length)await db.collection(collection).doc(existing[0]._id).update({data})
  else await db.collection(collection).add({data:{...data,createdAt:new Date()}})
  const other=await permissionRows(otherCollection,phoneNumber,countryCode)
  await Promise.all(other.map(item=>db.collection(otherCollection).doc(item._id).remove()))
  return listPermissions()
}

async function updatePermission(event,openid){
  const operator=await requireAdmin(openid)
  const role=event.role==='admin'?'admin':'staff'
  const collection=role==='admin'?'admin_users':'staff_users'
  const id=String(event.id||'')
  if(!id)throw new Error('权限记录不存在')
  const record=await db.collection(collection).doc(id).get()
  const phone=normalizePhone(record.data&&record.data.phoneNumber)
  const operatorPhone=normalizePhone(operator&&operator.phoneNumber)
  const operatorIsSuper=operatorPhone===SUPER_ADMIN_PHONE||operatorPhone==='86'+SUPER_ADMIN_PHONE
  if(role==='admin'&&!operatorIsSuper)throw new Error('普通管理员不能修改管理员账号')
  if(phone===SUPER_ADMIN_PHONE||phone==='86'+SUPER_ADMIN_PHONE)throw new Error('最高管理员不能停用')
  await db.collection(collection).doc(id).update({data:{enabled:!!event.enabled,updatedAt:new Date()}})
  return listPermissions()
}

async function deletePermission(event,openid){
  const operator=await requireAdmin(openid)
  const role=event.role==='admin'?'admin':'staff'
  const collection=role==='admin'?'admin_users':'staff_users'
  const id=String(event.id||'')
  if(!id)throw new Error('权限记录不存在')
  const record=await db.collection(collection).doc(id).get()
  const phone=normalizePhone(record.data&&record.data.phoneNumber)
  const operatorPhone=normalizePhone(operator&&operator.phoneNumber)
  const operatorIsSuper=operatorPhone===SUPER_ADMIN_PHONE||operatorPhone==='86'+SUPER_ADMIN_PHONE
  if(role==='admin'&&!operatorIsSuper)throw new Error('普通管理员不能移除管理员账号')
  if(phone===SUPER_ADMIN_PHONE||phone==='86'+SUPER_ADMIN_PHONE)throw new Error('最高管理员不能移除')
  await db.collection(collection).doc(id).remove()
  return listPermissions()
}

async function count(collection,eventId){
  const result=await db.collection(collection).where({eventId}).count()
  return result.total||0
}

function eventViewDocumentId(eventId,openid){
  const digest=crypto.createHash('sha256').update(`${eventId}\u0000${openid}`).digest('hex')
  return `view_${digest}`
}

async function recordEventView(eventId,openid){
  if(!openid)throw new Error('无法确认微信访客身份')
  await ensureCollection('event_views')
  // The deterministic document ID makes this a unique-visitor count per event:
  // reopening the same event never increments the count twice for one OpenID.
  await db.collection('event_views').doc(eventViewDocumentId(eventId,openid)).set({data:{eventId,lastViewedAt:new Date()}})
  return count('event_views',eventId)
}

async function eventStats(eventId,openid){
  await Promise.all(['event_views','event_likes','event_comments','event_shares'].map(ensureCollection))
  const values=await Promise.all([
    count('event_views',eventId),
    count('event_likes',eventId),
    count('event_comments',eventId),
    count('event_shares',eventId),
    db.collection('event_likes').where({eventId,openid}).limit(1).get(),
    db.collection('event_comments').where({eventId}).limit(50).get()
  ])
  const comments=(values[5].data||[]).map(item=>({
    id:item._id,
    nickname:item.nickname||'微信用户',
    content:item.content,
    createdAt:item.createdAt
  }))
  return {stats:{viewCount:values[0],liked:!!(values[4].data&&values[4].data.length),likeCount:values[1],commentCount:values[2],shareCount:values[3]},comments}
}

exports.main=async(event)=>{
  const wxContext=cloud.getWXContext()
  const openid=wxContext.OPENID
  if(!openid)return {ok:false,message:'无法确认微信身份，请重新进入小程序'}
  if(event&&event.action==='listPermissions'){
    try{return {ok:true,...await (await requireAdmin(openid),listPermissions())}}
    catch(error){return {ok:false,message:error.message||'无权限查看'}}
  }
  if(event&&event.action==='upsertPermission'){
    try{return {ok:true,...await upsertPermission(event,openid)}}
    catch(error){console.error('upsert permission failed',error);return {ok:false,message:error.message||'权限保存失败'}}
  }
  if(event&&event.action==='updatePermission'){
    try{return {ok:true,...await updatePermission(event,openid)}}
    catch(error){console.error('update permission failed',error);return {ok:false,message:error.message||'权限更新失败'}}
  }
  if(event&&event.action==='deletePermission'){
    try{return {ok:true,...await deletePermission(event,openid)}}
    catch(error){console.error('delete permission failed',error);return {ok:false,message:error.message||'权限删除失败'}}
  }
  if(event&&event.action==='getWorkRecords'){
    try{return {ok:true,...await getWorkRecords(event,openid)}}
    catch(error){console.error('get work records failed',error);return {ok:false,message:error.message||'成绩读取失败'}}
  }
  if(event&&event.action==='saveWorkRecords'){
    try{return {ok:true,...await saveWorkRecords(event,openid)}}
    catch(error){console.error('save work records failed',error);return {ok:false,message:error.message||'成绩保存失败'}}
  }
  if(event&&event.action==='uploadAllWorkRecords'){
    try{return {ok:true,...await uploadAllWorkRecords(event,openid)}}
    catch(error){console.error('upload all work records failed',error);return {ok:false,message:error.message||'成绩上传失败'}}
  }
  if(event&&event.action==='listReviewRecords'){
    try{return {ok:true,...await listReviewRecords(event,openid)}}
    catch(error){console.error('list review records failed',error);return {ok:false,message:error.message||'成绩审核列表读取失败'}}
  }
  if(event&&event.action==='approveAllScores'){
    try{return {ok:true,...await approveAllScores(event,openid)}}
    catch(error){console.error('approve all scores failed',error);return {ok:false,message:error.message||'成绩批量审核失败'}}
  }
  if(event&&event.action==='getRole'){
    const stored=await getStoredUser(openid)
    const access=stored&&stored.phoneNumber?await resolveRole({phoneNumber:stored.phoneNumber,countryCode:stored.countryCode||'86'}):{role:'user',isAdmin:false,isSuperAdmin:false,isStaff:false,stagePermissions:[],entryPermissions:normalizeEntryPermissions()}
    const role=access.role
    if(stored&&(stored.role!==role||!!stored.isAdmin!==access.isAdmin||!!stored.isSuperAdmin!==access.isSuperAdmin||!!stored.isStaff!==access.isStaff||JSON.stringify(stored.stagePermissions||[])!==JSON.stringify(access.stagePermissions||[])||JSON.stringify(stored.entryPermissions||{})!==JSON.stringify(access.entryPermissions||{}))){
      try{await db.collection('users').doc(stored._id).update({data:{role,isAdmin:access.isAdmin,isSuperAdmin:access.isSuperAdmin,isStaff:access.isStaff,stagePermissions:access.stagePermissions,entryPermissions:access.entryPermissions,updatedAt:new Date()}})}catch(error){console.warn('failed to refresh user role',error)}
    }
    return {ok:true,user:{id:stored&&stored._id||openid,nickname:stored&&stored.nickname||'微信用户',avatarUrl:stored&&stored.avatarUrl||'',loggedIn:true,role,isAdmin:access.isAdmin,isSuperAdmin:access.isSuperAdmin,isStaff:access.isStaff,stagePermissions:access.stagePermissions,entryPermissions:access.entryPermissions}}
  }
  if(event&&(event.action==='getEventStats'||event.action==='recordViewOpen'||event.action==='toggleLike'||event.action==='addComment'||event.action==='recordShare'||event.action==='recordShareOpen')){
    try{
      const eventId=validateEventId(event.eventId)
      if(event.action==='recordViewOpen'){
        await recordEventView(eventId,openid)
      }else if(event.action==='toggleLike'){
        const existing=await db.collection('event_likes').where({eventId,openid}).limit(1).get()
        if(existing.data&&existing.data.length)await db.collection('event_likes').doc(existing.data[0]._id).remove()
        else await db.collection('event_likes').add({data:{eventId,openid,createdAt:new Date()}})
      }else if(event.action==='addComment'){
        const content=String(event.content||'').trim().slice(0,200)
        if(!content)return {ok:false,message:'评论内容不能为空'}
        await db.collection('event_comments').add({data:{eventId,openid,nickname:'微信用户',content,createdAt:new Date()}})
      }else if(event.action==='recordShare'||event.action==='recordShareOpen'){
        await db.collection('event_shares').add({data:{eventId,openid,source:event.source||'unknown',type:event.action==='recordShareOpen'?'open':'intent',createdAt:new Date()}})
      }
      return {ok:true,...await eventStats(eventId,openid)}
    }catch(error){
      console.error('event interaction failed',event.action,error)
      return {ok:false,message:'互动记录服务暂时不可用'}
    }
  }
  if(!event||event.action!=='loginPhone')return {ok:false,message:'不支持的登录方式'}
  if(!event.code)return {ok:false,message:'缺少手机号授权凭证'}

  let phoneInfo
  try{
    const result=await cloud.openapi.phonenumber.getPhoneNumber({code:event.code})
    // 兼容不同云 SDK 返回的 snake_case / camelCase 包装层。
    phoneInfo=result&&(result.phone_info||result.phoneInfo||(result.data&&result.data.phone_info))
  }catch(error){
    console.error('getPhoneNumber failed',error)
    return {ok:false,message:'手机号授权凭证已失效，请重新授权'}
  }
  // 不同基础库/云 SDK 可能只返回 purePhoneNumber；两种字段都可用于身份校验。
  const verifiedPhone=phoneInfo&&(phoneInfo.phoneNumber||phoneInfo.purePhoneNumber)
  if(!verifiedPhone)return {ok:false,message:'未能读取微信手机号'}

  const access=await resolveRole(phoneInfo)

  const now=new Date()
  const user={
    openid:wxContext.OPENID,
    unionid:wxContext.UNIONID||'',
    nickname:'微信用户',
    avatarUrl:'',
    phoneNumber:normalizePhone(verifiedPhone),
    countryCode:phoneInfo.countryCode||'86',
    role:access.role,
    isAdmin:access.isAdmin,
    isSuperAdmin:access.isSuperAdmin,
    isStaff:access.isStaff,
    stagePermissions:access.stagePermissions,
    entryPermissions:access.entryPermissions,
    updatedAt:now
  }
  try{
    const existing=await db.collection('users').where({openid:wxContext.OPENID}).limit(1).get()
    if(existing.data&&existing.data.length){
      await db.collection('users').doc(existing.data[0]._id).update({data:user})
      user.id=existing.data[0]._id
    }else{
      const created=await db.collection('users').add({data:{...user,createdAt:now}})
      user.id=created._id
    }
  }catch(error){
    console.error('failed to persist verified user',error)
    return {ok:false,message:'登录资料保存失败，请稍后重新授权'}
  }
  // 手机号和 openid 只保存在云端，不返回给客户端，也不写入本地缓存。
  return {
    ok:true,
    user:{
      id:user.id,
      nickname:user.nickname,
      avatarUrl:user.avatarUrl,
      loggedIn:true,
      role:user.role,
      isAdmin:user.isAdmin,
      isSuperAdmin:user.isSuperAdmin,
      isStaff:user.isStaff,
      stagePermissions:access.stagePermissions,
      entryPermissions:access.entryPermissions
    }
  }
}

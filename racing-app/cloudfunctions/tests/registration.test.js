const assert=require('node:assert/strict')
const {test}=require('node:test')
const crypto=require('node:crypto')

function setup(){
  const docs=new Map()
  docs.set('events/e1',{_id:'e1',id:'race-1',published:true,registrationEnabled:true,signupOptions:[{name:'四驱组',fee:'3000',quota:'2'}]})
  const collection=name=>({
    where:query=>({limit:()=>({get:async()=>({data:[...docs.entries()].filter(([key,row])=>key.startsWith(name+'/')&&Object.entries(query).every(([k,v])=>row[k]===v)).map(([,row])=>structuredClone(row))})})}),
    doc:id=>({
      get:async()=>({data:structuredClone(docs.get(name+'/'+id)||null)}),
      set:async({data})=>docs.set(name+'/'+id,{...structuredClone(data),_id:id}),
      update:async({data})=>docs.set(name+'/'+id,{...docs.get(name+'/'+id),...structuredClone(data),_id:id})
    })
  })
  let queue=Promise.resolve()
  const db={collection,runTransaction:fn=>{const next=queue.then(()=>fn({collection:name=>({doc:id=>collection(name).doc(id)})}));queue=next.catch(()=>{});return next}}
  const handle=require('../account/registration').createRegistrationService({db,ensureCollection:async()=>{},getStoredUser:async()=>({phoneNumber:'13800138000'})})
  const submit=(extra={},openid='user-1')=>handle({action:'submitRegistration',eventId:'race-1',requestId:'request-one',form:{组别:'四驱组',赛号:'23',姓名:'张三',手机号:'13800138000',身份证:'110101199001010011',...extra}},openid)
  return {docs,db,handle,submit}
}

test('mini-program signup appends the existing website signup document with a new revision and idempotent retry',async()=>{
  const {docs,submit,handle}=setup()
  const id='ed_'+crypto.createHash('sha256').update('race-1::signup-race-1').digest('hex').slice(0,40)
  docs.set('event_management_data/'+id,{eventId:'race-1',key:'signup-race-1',revision:4,value:[{id:'web-row',组别:'四驱组',赛号:'1',姓名:'后台车手'}]})
  const saved=await submit({支付:'已支付',金额:'0',openid:'forged'})
  assert.equal(saved.revision,5)
  const current=docs.get('event_management_data/'+id)
  assert.equal(current.value.length,2)
  assert.equal(current.value[0].id,'web-row')
  assert.equal(current.value[1].支付,'未支付')
  assert.equal(current.value[1].金额,'3000')
  assert.equal(current.value[1].submittedBy,'user-1')
  assert.equal((await submit()).revision,5)
  const listed=await handle({action:'listRegistrations',eventId:'race-1'},'other-user')
  assert.equal(listed.rows.length,2)
  assert.doesNotMatch(JSON.stringify(listed),/110101199001010011|13800138000|submittedBy/)
  const own=await handle({action:'getRegistrationProfiles',eventId:'race-1'},'user-1')
  assert.equal(own.profiles[0].姓名,'张三')
  assert.deepEqual((await handle({action:'getRegistrationProfiles',eventId:'race-1'},'other-user')).profiles,[])
})

test('disabled, unpublished, expired and invalid signups cannot write',async()=>{
  const {docs,submit}=setup()
  const event=docs.get('events/e1')
  for(const values of [{registrationEnabled:false},{published:false},{registrationDeadline:'2020-01-01'},{deleted:true}]){
    docs.set('events/e1',{...event,...values})
    await assert.rejects(submit(),/报名|赛事/)
  }
  docs.set('events/e1',event)
  await assert.rejects(submit({组别:'不存在'}),/组别/)
  await assert.rejects(submit({手机号:'abc'}),/手机号/)
  await assert.rejects(submit({姓名:''}),/姓名/)
  assert.equal([...docs.keys()].filter(k=>k.startsWith('event_management_data/')).length,0)
})

test('concurrent signups retain both rows, enforce unique car numbers and group quota',async()=>{
  const {handle,submit}=setup()
  await Promise.all([submit(),handle({action:'submitRegistration',eventId:'race-1',requestId:'request-two',form:{组别:'四驱组',赛号:'24',姓名:'李四',手机号:'13900139000'}},'user-2')])
  await assert.rejects(handle({action:'submitRegistration',eventId:'race-1',requestId:'request-three',form:{组别:'四驱组',赛号:'23',姓名:'王五',手机号:'13900139000'}},'user-3'),/赛号/)
  await assert.rejects(handle({action:'submitRegistration',eventId:'race-1',requestId:'request-four',form:{组别:'四驱组',赛号:'25',姓名:'王五',手机号:'13900139000'}},'user-3'),/上限/)
})

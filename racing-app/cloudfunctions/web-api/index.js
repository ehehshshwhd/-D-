const cloud = require('wx-server-sdk')
const crypto = require('crypto')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const STAGES = Array.from({ length: 20 }, (_, index) => `SS${index + 1}`)
const MAX_ROWS = 1000
const SESSION_COOKIE_MAX_AGE = 2147483647

function env(name) { return String(process.env[name] || '').trim() }
function json(value) { try { return JSON.parse(value || '{}') } catch { return {} } }
function response(statusCode, payload, headers = {}) {
  return { statusCode, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers }, body: JSON.stringify(payload), isBase64Encoded: false }
}
function header(event, name) {
  const headers = event.headers || event.requestContext && event.requestContext.http && event.requestContext.http.headers || {}
  return headers[name] || headers[name.toLowerCase()] || headers[name.toUpperCase()] || ''
}
function cookie(event, name) {
  return String(header(event, 'cookie')).split(';').map(item => item.trim()).find(item => item.startsWith(`${name}=`))?.slice(name.length + 1) || ''
}
function sign(value) { return crypto.createHmac('sha256', env('WEB_API_SESSION_SECRET')).update(value).digest('base64url') }
function makeSession() {
  const payload = Buffer.from(JSON.stringify({ v: 1 })).toString('base64url')
  return `${payload}.${sign(payload)}`
}
function validSession(event) {
  const token = cookie(event, 'score_session')
  const [payload, signature] = token.split('.')
  if (!payload || !signature || !env('WEB_API_SESSION_SECRET')) return false
  const expected = sign(payload)
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return false
  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString())
    return session && (session.v === 1 || (Number.isFinite(session.exp) && session.exp > Date.now()))
  } catch { return false }
}
class RequestValidationError extends Error {}
class RevisionConflictError extends Error { constructor(message) { super(message); this.code = 'REVISION_CONFLICT' } }
function validateEventId(value) {
  if (typeof value !== 'string') throw new RequestValidationError('赛事 ID 必须是 1 到 80 位字母、数字、下划线或连字符')
  const eventId = value.trim()
  if (!eventId || eventId.length > 80 || !/^[A-Za-z0-9_-]+$/.test(eventId)) throw new RequestValidationError('赛事 ID 必须是 1 到 80 位字母、数字、下划线或连字符')
  return eventId
}
function key(eventId, stage) { return { eventId: validateEventId(eventId), stage: String(stage || '').toUpperCase() } }

function validateRows(rows) {
  if (!Array.isArray(rows)) throw new RequestValidationError('成绩列表格式无效')
  if (rows.length > MAX_ROWS) throw new RequestValidationError(`每个赛段最多保存 ${MAX_ROWS} 条成绩`)
  const seenCars = new Set()
  const textLimits = {
    id: 80, group: 100, groupName: 100, teamName: 100, driver: 80, name: 80,
    stage1: 24, stage2: 24, stage3: 24, validScore: 24, importedStage: 24,
    startTime: 24, start: 24, endTime: 24, finish: 24,
    penaltyTotal: 16, penalty: 16, segmentDuration: 24, totalDuration: 24,
    duration: 24, uploader: 80, uploadedAt: 80, note: 500
  }
  const text = (value, field, max) => {
    if (value == null) return ''
    if (!['string', 'number'].includes(typeof value)) throw new RequestValidationError(`${field} 格式无效`)
    const result = String(value)
    if (result.length > max) throw new RequestValidationError(`${field} 超出 ${max} 个字符`)
    return result
  }
  const cleaned = rows.map((row, index) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new RequestValidationError(`第 ${index + 1} 条成绩格式无效`)
    const label = `第 ${index + 1} 条成绩`
    for (const [field, max] of Object.entries(textLimits)) {
      if (row[field] != null) text(row[field], `${label}的 ${field}`, max)
    }
    if (row.car != null) text(row.car, `${label}的 car`, 12)
    for (const field of ['imported', 'durationManual']) {
      if (row[field] != null && typeof row[field] !== 'boolean') throw new RequestValidationError(`${label}的 ${field} 格式无效`)
    }
    const rawCar = row.carNumber == null || row.carNumber === '' ? row.car : row.carNumber
    if (rawCar != null && !['string', 'number'].includes(typeof rawCar)) throw new RequestValidationError(`${label}的车号格式无效`)
    const carNumber = String(rawCar || '').replace(/[^0-9a-z]/gi, '').toUpperCase()
    if (!carNumber) throw new RequestValidationError(`${label}没有有效车号`)
    if (carNumber.length > 12) throw new RequestValidationError(`${label}车号超过 12 位`)
    if (seenCars.has(carNumber)) throw new RequestValidationError(`车号 ${carNumber} 重复，请检查后重试`)
    seenCars.add(carNumber)
    if (row.penaltyInputs != null && !Array.isArray(row.penaltyInputs)) throw new RequestValidationError(`${label}罚时格式无效`)
    if (Array.isArray(row.penaltyInputs) && row.penaltyInputs.length > 10) throw new RequestValidationError(`${label}罚时项目最多 10 项`)
    const penaltyInputs = Array.isArray(row.penaltyInputs) ? row.penaltyInputs.map((item, penaltyIndex) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) throw new RequestValidationError(`${label}第 ${penaltyIndex + 1} 项罚时格式无效`)
      return { ...item, id: text(item.id || `penalty-${penaltyIndex}`, `${label}罚时编号`, 80), value: text(item.value, `${label}罚时内容`, 12) }
    }) : []
    const id = text(row.id || `web-${index}`, `${label}的 id`, 80)
    const startTime = text(row.startTime || row.start, `${label}的发车时间`, 24)
    const endTime = text(row.endTime || row.finish, `${label}的收车时间`, 24)
    const penaltyTotal = text(row.penaltyTotal || row.penalty, `${label}的罚时`, 16)
    const segmentDuration = text(row.segmentDuration || row.duration, `${label}的赛段用时`, 24)
    const totalDuration = text(row.totalDuration || row.duration, `${label}的总用时`, 24)
    const group = text(String(row.group || row.groupName || row.teamName || '').trim(), `${label}的组别`, 100)
    const teamName = text(String(row.teamName || row.groupName || row.group || '').trim(), `${label}的车队`, 100)
    const driver = text(String(row.driver || row.name || '').trim(), `${label}的车手`, 80)
    if (row.status != null && !['string', 'number'].includes(typeof row.status)) throw new RequestValidationError(`${label}的审核状态格式无效`)
    const status = ['approved', 'returned', 'pending'].includes(String(row.status || '').toLowerCase()) ? String(row.status).toLowerCase() : 'pending'
    const custom = { ...row }
    ;['_id', '_openid', 'openid', 'eventId', 'stage', 'revision', 'createdAt', 'updatedAt', 'updatedBy', 'updatedByPhone', 'updatedByRole'].forEach(key => delete custom[key])
    return {
      ...custom,
      id, carNumber, group, teamName, driver,
      stage1: text(row.stage1, `${label}的 stage1`, 24),
      stage2: text(row.stage2, `${label}的 stage2`, 24),
      stage3: text(row.stage3, `${label}的 stage3`, 24),
      validScore: text(row.validScore, `${label}的有效成绩`, 24),
      imported: row.imported === true,
      importedStage: text(row.importedStage, `${label}的 importedStage`, 24),
      startTime, endTime, penaltyInputs, penaltyTotal, segmentDuration,
      totalDuration, durationManual: row.durationManual === true,
      uploader: text(row.uploader, `${label}的上传人`, 80),
      uploadedAt: text(row.uploadedAt, `${label}的上传时间`, 80),
      note: text(row.note, `${label}的备注`, 500), status
    }
  })
  if (Buffer.byteLength(JSON.stringify(cleaned), 'utf8') > 700 * 1024) throw new RequestValidationError('当前赛段成绩超过 CloudBase 单文档安全大小，请分段检查后重试')
  return cleaned
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue)
  if (value && typeof value === 'object') {
    const result = {}
    Object.keys(value).sort().forEach(name => { result[name] = stableValue(value[name]) })
    return result
  }
  return value
}
function stableJson(value) { return JSON.stringify(stableValue(value)) }
function copyRecordMetadata(record) {
  const data = record && typeof record === 'object' ? { ...record } : {}
  ;['_id', '_openid', 'openid', 'eventId', 'stage', 'rows', 'revision', 'createdAt', 'updatedAt', 'updatedBy', 'updatedByPhone', 'updatedByRole'].forEach(name => delete data[name])
  return data
}
async function findRecord(pair) {
  // Equality filtering does not require a custom composite index.  Limit to
  // two documents so duplicate event/stage records remain detectable.
  const result = await db.collection('work_records').where(pair).limit(2).get()
  if (result.data && result.data.length > 1) {
    throw new Error(`云端成绩记录重复：${pair.eventId}/${pair.stage}；请先清理重复记录`)
  }
  return result.data && result.data[0] || null
}
function rowsFromRecord(record) {
  if (!record) return []
  if (!Array.isArray(record.rows)) throw new Error('云端成绩格式无效：rows 不是数组')
  return validateRows(record.rows)
}
async function ensureCollection() {
  try { await db.collection('work_records').limit(1).get() } catch (error) {
    if (!String(error && (error.errMsg || error.message) || '').includes('-502005')) throw error
    try { await db.createCollection('work_records') } catch { await db.collection('work_records').limit(1).get() }
  }
}
async function getRecords(event) {
  const pair = key(event.queryStringParameters && event.queryStringParameters.eventId, event.queryStringParameters && event.queryStringParameters.stage)
  if (!STAGES.includes(pair.stage)) return response(400, { ok: false, message: '赛段无效' })
  await ensureCollection()
  const record = await findRecord(pair)
  const rows = rowsFromRecord(record)
  const revision = Number(record && record.revision)
  return response(200, { ok: true, rows, count: rows.length, revision: Number.isSafeInteger(revision) && revision >= 0 ? revision : 0, updatedAt: record && record.updatedAt || null, updatedByPhone: record && record.updatedByPhone || '' })
}
async function putRecords(event) {
  const input = json(event.body)
  const pair = key(input.eventId, input.stage)
  if (!STAGES.includes(pair.stage) || !Array.isArray(input.rows)) throw new RequestValidationError('赛事、赛段或成绩格式无效')
  await ensureCollection()
  const expectedRevision = input.expectedRevision
  if (typeof expectedRevision !== 'number' || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || expectedRevision >= Number.MAX_SAFE_INTEGER) throw new RequestValidationError('成绩版本号缺失，请刷新赛段后重试')
  const rows = validateRows(input.rows)
  if (typeof db.runTransaction !== 'function') throw new Error('云数据库事务不可用，未写入成绩；请检查云函数 SDK 后重试')
  const revision = expectedRevision + 1
  const documentId = `work_${crypto.createHash('sha256').update(`${pair.eventId}::${pair.stage}`).digest('hex').slice(0, 40)}`
  const existing = await findRecord(pair)
  const recordId = existing && existing._id || documentId
  await db.runTransaction(async transaction => {
    const collection = transaction.collection('work_records')
    let current = null
    try {
      const result = await collection.doc(recordId).get()
      current = result && result.data && typeof result.data === 'object' ? result.data : null
    } catch (error) {
      const message = String(error && (error.errMsg || error.message) || '').toLowerCase()
      if (!/not.?found|not exist|does not exist|不存在/.test(message)) throw error
    }
    const previousRevision = Number(current && current.revision)
    const actualRevision = Number.isSafeInteger(previousRevision) && previousRevision >= 0 ? previousRevision : 0
    if (actualRevision !== expectedRevision) throw new RevisionConflictError(`成绩已被其他设备修改（云端版本 ${actualRevision}，本地版本 ${expectedRevision}），本次未覆盖云端数据；请刷新后重试`)
    const now = new Date()
    const data = { ...copyRecordMetadata(current), ...pair, rows, revision, updatedAt: now, updatedBy: 'web-admin', updatedByPhone: '网页管理员', updatedByRole: 'admin' }
    if (current) await collection.doc(recordId).update({ data })
    else await collection.doc(documentId).set({ data: { ...data, createdAt: now } })
    const saved = await collection.doc(recordId).get()
    const verified = rowsFromRecord(saved && saved.data)
    if (verified.length !== rows.length || stableJson(verified) !== stableJson(rows) || Number(saved.data && saved.data.revision || 0) !== revision) throw new Error(`云端事务内回读核对失败：只确认 ${verified.length}/${rows.length} 条，未确认成绩已保存`)
  })
  return response(200, { ok: true, count: rows.length, revision, verified: true })
}

exports.main = async event => {
  const method = String(event.httpMethod || event.requestContext && event.requestContext.http && event.requestContext.http.method || 'GET').toUpperCase()
  const path = String(event.path || event.requestContext && event.requestContext.http && event.requestContext.http.path || '')
  if (method === 'OPTIONS') return response(204, {}, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Credentials': 'true', 'Access-Control-Allow-Headers': 'Content-Type' })
  if (method === 'POST' && path.endsWith('/api/session')) {
    const input = json(event.body)
    const password = env('WEB_API_PASSWORD')
    if (!password || String(input.password || '') !== password) return response(401, { ok: false, message: '网页密码错误' })
    return response(200, { ok: true }, { 'Set-Cookie': `score_session=${makeSession()}; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_COOKIE_MAX_AGE}; Path=/` })
  }
  if (!validSession(event)) return response(401, { ok: false, message: '请先登录网页后台' })
  if (method === 'GET' && path.endsWith('/api/session')) return response(200, { ok: true })
  if (method === 'GET' && path.endsWith('/api/work-records')) {
    try { return await getRecords(event) }
    catch (error) {
      console.error('read work records failed', error)
      return response(error instanceof RequestValidationError ? 400 : 502, { ok: false, message: error.message || '成绩读取失败' })
    }
  }
  if (method === 'PUT' && path.endsWith('/api/work-records')) {
    try { return await putRecords(event) }
    catch (error) {
      console.error('write work records failed', error)
      const status = error instanceof RevisionConflictError ? 409 : error instanceof RequestValidationError ? 400 : 502
      return response(status, { ok: false, code: error.code || undefined, message: error.message || '成绩保存失败' })
    }
  }
  return response(404, { ok: false, message: '接口不存在' })
}

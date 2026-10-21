const container = require('../../utils/cloud-container')

const LEGACY_EVENTS = [
  {
    id: 'suiping',
    title: '2026中国·遂平嵖岈山首届汽车越野嘉年华《赛事预报》',
    date: '2026-08-23 ~ 2026-08-30',
    location: '河南省-驻马店市-遂平县　(报到地点待定)',
    status: '已完赛',
    kind: 'event2',
    notice: ''
  }
]

// These old built-in cards are retired. Keep filtering their IDs while cloud
// records are migrated so an old published document cannot resurrect them.
const RETIRED_EVENT_IDS = new Set(['dabieshan', 'linxi'])

function readEventList(response) {
  let payload = response && response.data
  if (typeof payload === 'string') {
    try { payload = JSON.parse(payload) } catch (_) { return [] }
  }
  const events = payload && payload.events
  return Array.isArray(events) ? events : []
}

function eventDate(event) {
  if (event.date) return String(event.date)
  const start = String(event.dateStart || '')
  const end = String(event.dateEnd || '')
  if (start && end) return `${start} ~ ${end}`
  return start || end
}

function timestamp(value) {
  if (!value) return 0
  const result = new Date(value).getTime()
  return Number.isFinite(result) ? result : 0
}

function mergePublishedEvents(publishedEvents, cloudAuthoritative = false) {
  const legacyById = Object.create(null)
  LEGACY_EVENTS.forEach(event => { legacyById[event.id] = event })

  const published = publishedEvents
    .filter(event => event && (event.id || event._id)
      && !RETIRED_EVENT_IDS.has(String(event.id || event._id)))
    .map(event => {
      const id = String(event.id || event._id)
      const legacy = legacyById[id] || {}
      return {
        ...legacy,
        id,
        title: String(event.title || legacy.title || '赛事详情'),
        date: eventDate(event) || legacy.date || '',
        location: String(event.location || legacy.location || ''),
        status: String(event.status || legacy.status || ''),
        notice: event.notice == null ? '' : String(event.notice || ''),
        coverFileId: String(event.coverFileId || ''),
        coverUrl: String(event.coverUrl || ''),
        detailText: String(event.detailText || ''),
        publishedAt: event.publishedAt || null,
        kind: legacy.kind || 'custom'
      }
    })
    .sort((left, right) => timestamp(right.publishedAt) - timestamp(left.publishedAt)
      || timestamp(right.createdAt) - timestamp(left.createdAt))

  const publishedIds = new Set(published.map(event => event.id))
  return cloudAuthoritative ? published : published.concat(LEGACY_EVENTS.filter(event => !publishedIds.has(event.id)))
}

function resolveCoverUrls(events) {
  if (!wx.cloud || typeof wx.cloud.getTempFileURL !== 'function') return Promise.resolve(events)
  const fileIds = Array.from(new Set(events.map(event => event.coverFileId).filter(Boolean)))
  if (!fileIds.length) return Promise.resolve(events)
  return wx.cloud.getTempFileURL({ fileList: fileIds }).then(response => {
    const urls = Object.create(null)
    ;(response && response.fileList || []).forEach(file => {
      if (file && file.fileID && file.tempFileURL) urls[file.fileID] = file.tempFileURL
    })
    return events.map(event => event.coverUrl || !event.coverFileId
      ? event
      : { ...event, coverUrl: urls[event.coverFileId] || '' })
  }).catch(error => {
    console.warn('赛事封面加载失败', error)
    return events
  })
}

Page({
  data: { events: LEGACY_EVENTS },
  onShow() {
    const bar = this.getTabBar && this.getTabBar()
    if (bar) bar.setData({ selected: 0 })
    this.loadPublishedEvents()
  },
  loadPublishedEvents() {
    const requestId = (this._eventsRequestId || 0) + 1
    this._eventsRequestId = requestId
    container.call('/api/public/events').then(readEventList).then(resolveCoverUrls).then(events => {
      if (this._eventsRequestId !== requestId) return
      this.setData({ events: mergePublishedEvents(events, true) })
    }).catch(error => {
      // Keep the built-in cards visible when the cloud service is unavailable.
      console.warn('读取已发布赛事失败，继续显示内置赛事', error)
    })
  },
  openEvent(event) {
    const id = event.currentTarget.dataset.id
    if (!id) return
    wx.navigateTo({ url: '/subpackages/events/detail/detail?id=' + encodeURIComponent(id) })
  }
})

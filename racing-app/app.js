const auth = require('./utils/auth')
const container = require('./utils/cloud-container')

App({
  onLaunch() {
    auth.init()
    container.init()
  }
})

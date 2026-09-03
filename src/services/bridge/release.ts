import policy from '../../../release/bridge-distribution.json'

export const BRIDGE_DOWNLOAD_PAUSED = policy.availability !== 'available'
export const BRIDGE_DOWNLOAD_STATUS_URL = policy.statusPage
export const BRIDGE_DOWNLOAD_URL = policy.downloadPath

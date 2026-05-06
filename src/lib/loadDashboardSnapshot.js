import { normalizeDashboardSnapshot } from './dashboardContracts.js'

export const DASHBOARD_SNAPSHOT_URL = '/mock/wyckoff-dashboard.json'

export async function loadDashboardSnapshot() {
  const response = await fetch(DASHBOARD_SNAPSHOT_URL, {
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    throw new Error(`本地快照加载失败（HTTP ${response.status}）`)
  }

  const snapshot = await response.json()
  return normalizeDashboardSnapshot(snapshot)
}
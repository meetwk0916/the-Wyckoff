export const FILTER_STORAGE_KEYS = {
  phase: 'wyckoff-mvp-phase-filter',
  status: 'wyckoff-mvp-status-filter',
  acknowledgedAlerts: 'wyckoff-mvp-acknowledged-alerts',
  selectedSymbol: 'wyckoff-mvp-selected-symbol',
}

const DEFAULT_SYSTEM_STATUS = {
  connectionLabel: '本地快照准备中',
  dataSourceLabel: '等待加载本地快照',
  modeLabel: '本地 JSON 模式',
}

const DEFAULT_PHASE_OPTIONS = [
  { value: 'all', label: '全部阶段' },
  { value: 'Phase A', label: 'Phase A' },
  { value: 'Phase B', label: 'Phase B' },
  { value: 'Phase C', label: 'Phase C' },
  { value: 'Phase D', label: 'Phase D' },
]

const DEFAULT_STATUS_OPTIONS = [
  { value: 'all', label: '全部信号' },
  { value: 'ACTION_REQUIRED', label: '可复核' },
  { value: 'MONITORING', label: '待验证' },
  { value: 'BLOCKED', label: '被拦截' },
  { value: 'BUILDING', label: '构建中' },
]

export const EMPTY_DASHBOARD_SNAPSHOT = {
  systemStatus: DEFAULT_SYSTEM_STATUS,
  phaseOptions: DEFAULT_PHASE_OPTIONS,
  statusOptions: DEFAULT_STATUS_OPTIONS,
  watchlist: [],
  alerts: [],
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function normalizeDashboardSnapshot(snapshot) {
  const safeSnapshot = isPlainObject(snapshot) ? snapshot : {}

  return {
    systemStatus: isPlainObject(safeSnapshot.systemStatus)
      ? { ...DEFAULT_SYSTEM_STATUS, ...safeSnapshot.systemStatus }
      : DEFAULT_SYSTEM_STATUS,
    phaseOptions:
      Array.isArray(safeSnapshot.phaseOptions) && safeSnapshot.phaseOptions.length > 0
        ? safeSnapshot.phaseOptions
        : DEFAULT_PHASE_OPTIONS,
    statusOptions:
      Array.isArray(safeSnapshot.statusOptions) && safeSnapshot.statusOptions.length > 0
        ? safeSnapshot.statusOptions
        : DEFAULT_STATUS_OPTIONS,
    watchlist: Array.isArray(safeSnapshot.watchlist) ? safeSnapshot.watchlist : [],
    alerts: Array.isArray(safeSnapshot.alerts) ? safeSnapshot.alerts : [],
  }
}
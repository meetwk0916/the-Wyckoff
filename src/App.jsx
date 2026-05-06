import { useEffect, useMemo, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  Bell,
  CheckCircle2,
  Clock3,
  Crosshair,
  Database,
  RefreshCcw,
  ShieldAlert,
  Signal,
  TrendingUp,
  Wifi,
} from 'lucide-react'
import { EMPTY_DASHBOARD_SNAPSHOT, FILTER_STORAGE_KEYS } from './lib/dashboardContracts.js'
import { loadDashboardSnapshot } from './lib/loadDashboardSnapshot.js'
import { EMPTY_PTRADE_HEALTH, loadPtradeHealth, loadPtradeOrderFlow } from './lib/loadPtradeBridge.js'
import './app.css'

function readSessionValue(key, fallbackValue) {
  try {
    return window.sessionStorage.getItem(key) || fallbackValue
  } catch {
    return fallbackValue
  }
}

function readSessionList(key) {
  try {
    const raw = window.sessionStorage.getItem(key)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function persistSessionValue(key, value) {
  try {
    window.sessionStorage.setItem(key, value)
  } catch {
    // Ignore storage failures in the MVP.
  }
}

function persistSessionList(key, value) {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Ignore storage failures in the MVP.
  }
}

function getStatusTone(status) {
  switch (status) {
    case 'ACTION_REQUIRED':
      return 'action'
    case 'MONITORING':
      return 'monitor'
    case 'BLOCKED':
      return 'blocked'
    default:
      return 'building'
  }
}

function getStatusLabel(status) {
  switch (status) {
    case 'ACTION_REQUIRED':
      return '可复核'
    case 'MONITORING':
      return '待验证'
    case 'BLOCKED':
      return '被拦截'
    default:
      return '构建中'
  }
}

function getValidationTone(status) {
  switch (status) {
    case 'READY':
      return 'action'
    case 'PENDING':
      return 'monitor'
    default:
      return 'blocked'
  }
}

function getValidationLabel(status) {
  switch (status) {
    case 'READY':
      return 'L2 已完成'
    case 'PENDING':
      return 'L2 待验证'
    default:
      return 'L2 未开放'
  }
}

function formatCurrency(value) {
  return Number(value).toFixed(2)
}

function formatRange(range) {
  if (!range || range.every((value) => value === 0)) {
    return '--'
  }

  return `${formatCurrency(range[0])} - ${formatCurrency(range[1])}`
}

function formatTime(value) {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(value)
}

function getToolbarStatusLabel(loadState, lastUpdated, loadError) {
  if (loadState === 'error') {
    return loadError
  }

  if (loadState === 'ready') {
    return `最后更新 ${formatTime(lastUpdated)}`
  }

  if (loadState === 'refreshing') {
    return '正在刷新本地快照'
  }

  return '正在加载本地快照'
}

function getPtradeTone(status) {
  switch (status) {
    case 'connected':
      return 'action'
    case 'mock_ready':
      return 'monitor'
    case 'loading':
    case 'refreshing':
      return 'building'
    default:
      return 'blocked'
  }
}

function getPtradeLabel(status) {
  switch (status) {
    case 'connected':
      return '真实已连接'
    case 'mock_ready':
      return '联调就绪'
    case 'not_configured':
      return '未配置'
    case 'loading':
    case 'refreshing':
      return '检查中'
    default:
      return '连接失败'
  }
}

function formatDateTime(value) {
  if (!value) {
    return '--'
  }

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return '--'
  }

  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date)
}

function formatOrderLevel(level) {
  if (!level) {
    return '--'
  }

  return `${formatCurrency(level.price)} / ${level.volume}`
}

function formatPercent(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '--'
  }

  return `${(value * 100).toFixed(0)}%`
}

export default function App() {
  const [dashboardSnapshot, setDashboardSnapshot] = useState(EMPTY_DASHBOARD_SNAPSHOT)
  const [ptradeHealth, setPtradeHealth] = useState(EMPTY_PTRADE_HEALTH)
  const [ptradeOrderFlow, setPtradeOrderFlow] = useState(null)
  const [ptradeOrderFlowMessage, setPtradeOrderFlowMessage] = useState('正在等待 ptrade bridge。')
  const [loadState, setLoadState] = useState('loading')
  const [loadError, setLoadError] = useState('')
  const [phaseFilter, setPhaseFilter] = useState(() => readSessionValue(FILTER_STORAGE_KEYS.phase, 'all'))
  const [statusFilter, setStatusFilter] = useState(() => readSessionValue(FILTER_STORAGE_KEYS.status, 'all'))
  const [acknowledgedAlerts, setAcknowledgedAlerts] = useState(() => readSessionList(FILTER_STORAGE_KEYS.acknowledgedAlerts))
  const [selectedSymbol, setSelectedSymbol] = useState(() => readSessionValue(FILTER_STORAGE_KEYS.selectedSymbol, ''))
  const [lastUpdated, setLastUpdated] = useState(() => new Date())

  const { alerts: alertFeed, phaseOptions, statusOptions, systemStatus, watchlist } = dashboardSnapshot

  useEffect(() => {
    let isActive = true

    async function bootstrapDashboardSnapshot() {
      try {
        const snapshot = await loadDashboardSnapshot()

        if (!isActive) {
          return
        }

        setDashboardSnapshot(snapshot)
        setLastUpdated(new Date())
        setLoadState('ready')
      } catch (error) {
        if (!isActive) {
          return
        }

        setLoadError(error instanceof Error ? error.message : '加载本地快照失败，请稍后重试。')
        setLoadState('error')
      }
    }

    void bootstrapDashboardSnapshot()

    return () => {
      isActive = false
    }
  }, [])

  useEffect(() => {
    let isActive = true

    async function bootstrapPtradeHealth() {
      try {
        const health = await loadPtradeHealth()

        if (!isActive) {
          return
        }

        setPtradeHealth(health)
      } catch (error) {
        if (!isActive) {
          return
        }

        setPtradeHealth({
          ...EMPTY_PTRADE_HEALTH,
          status: 'error',
          message: error instanceof Error ? error.message : 'ptrade bridge 检查失败，请稍后重试。',
        })
      }
    }

    void bootstrapPtradeHealth()

    return () => {
      isActive = false
    }
  }, [])

  async function refreshDashboardSnapshot(nextState = 'refreshing') {
    setLoadState(nextState)
    setLoadError('')

    try {
      const snapshot = await loadDashboardSnapshot()
      setDashboardSnapshot(snapshot)
      setLastUpdated(new Date())
      setLoadState('ready')
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : '加载本地快照失败，请稍后重试。')
      setLoadState('error')
    }
  }

  async function refreshPtradeHealth(nextStatus = 'refreshing') {
    setPtradeHealth((currentValue) => ({
      ...currentValue,
      status: nextStatus,
      message: '正在检查 ptrade bridge。',
    }))

    try {
      const health = await loadPtradeHealth()
      setPtradeHealth(health)
      return health
    } catch (error) {
      const fallback = {
        ...EMPTY_PTRADE_HEALTH,
        status: 'error',
        message: error instanceof Error ? error.message : 'ptrade bridge 检查失败，请稍后重试。',
      }

      setPtradeHealth(fallback)
      return fallback
    }
  }

  const filteredWatchlist = useMemo(() => {
    return watchlist.filter((item) => {
      const phasePass = phaseFilter === 'all' || item.phase === phaseFilter
      const statusPass = statusFilter === 'all' || item.status === statusFilter
      return phasePass && statusPass
    })
  }, [phaseFilter, statusFilter, watchlist])

  const summary = useMemo(() => {
    return {
      total: filteredWatchlist.length,
      actionable: filteredWatchlist.filter((item) => item.status === 'ACTION_REQUIRED').length,
      monitoring: filteredWatchlist.filter((item) => item.status === 'MONITORING').length,
      blocked: filteredWatchlist.filter((item) => item.status === 'BLOCKED').length,
    }
  }, [filteredWatchlist])

  const alerts = useMemo(() => {
    return alertFeed.map((alert) => ({
      ...alert,
      acknowledged: acknowledgedAlerts.includes(alert.id),
    }))
  }, [acknowledgedAlerts, alertFeed])

  const activeSelectedSymbol = useMemo(() => {
    if (filteredWatchlist.some((item) => item.symbol === selectedSymbol)) {
      return selectedSymbol
    }

    return filteredWatchlist[0]?.symbol ?? ''
  }, [filteredWatchlist, selectedSymbol])

  const selectedCandidate = useMemo(() => {
    return filteredWatchlist.find((item) => item.symbol === activeSelectedSymbol) ?? filteredWatchlist[0] ?? null
  }, [activeSelectedSymbol, filteredWatchlist])

  useEffect(() => {
    let isActive = true

    async function syncPtradeOrderFlow() {
      if (!activeSelectedSymbol) {
        setPtradeOrderFlow(null)
        setPtradeOrderFlowMessage('当前没有可跟踪的标的。')
        return
      }

      if (!['connected', 'mock_ready'].includes(ptradeHealth.status)) {
        setPtradeOrderFlow(null)

        if (ptradeHealth.status === 'not_configured') {
          setPtradeOrderFlowMessage('ptrade bridge 未配置，暂不拉取真实 L2 订单流。')
        } else if (ptradeHealth.status === 'error') {
          setPtradeOrderFlowMessage('ptrade bridge 检查失败，暂不拉取 L2 订单流。')
        } else {
          setPtradeOrderFlowMessage('正在等待 ptrade bridge 就绪。')
        }

        return
      }

      setPtradeOrderFlowMessage(`正在拉取 ${activeSelectedSymbol} 的 L2 订单流...`)

      try {
        const orderFlow = await loadPtradeOrderFlow(activeSelectedSymbol)

        if (!isActive) {
          return
        }

        setPtradeOrderFlow(orderFlow)
        setPtradeOrderFlowMessage('')
      } catch (error) {
        if (!isActive) {
          return
        }

        setPtradeOrderFlow(null)
        setPtradeOrderFlowMessage(error instanceof Error ? error.message : 'L2 订单流加载失败，请稍后重试。')
      }
    }

    void syncPtradeOrderFlow()

    return () => {
      isActive = false
    }
  }, [activeSelectedSymbol, ptradeHealth.status])

  function handlePhaseChange(event) {
    const nextValue = event.target.value
    setPhaseFilter(nextValue)
    persistSessionValue(FILTER_STORAGE_KEYS.phase, nextValue)
  }

  function handleStatusChange(event) {
    const nextValue = event.target.value
    setStatusFilter(nextValue)
    persistSessionValue(FILTER_STORAGE_KEYS.status, nextValue)
  }

  function handleRefresh() {
    void refreshDashboardSnapshot(loadState === 'ready' ? 'refreshing' : 'loading')
    void refreshPtradeHealth(ptradeHealth.status === 'loading' ? 'loading' : 'refreshing')
  }

  function handleSelectSymbol(symbol) {
    setSelectedSymbol(symbol)
    persistSessionValue(FILTER_STORAGE_KEYS.selectedSymbol, symbol)
  }

  function handleAcknowledge(alertId) {
    if (acknowledgedAlerts.includes(alertId)) {
      return
    }

    const nextAlerts = [...acknowledgedAlerts, alertId]
    setAcknowledgedAlerts(nextAlerts)
    persistSessionList(FILTER_STORAGE_KEYS.acknowledgedAlerts, nextAlerts)
  }

  const tableEmptyMessage =
    filteredWatchlist.length > 0
      ? ''
      : loadState === 'error' && watchlist.length === 0
        ? `${loadError} 请点击上方“刷新视图”重试。`
        : loadState !== 'ready' && watchlist.length === 0
          ? '正在加载监控快照...'
          : '当前过滤条件下没有可显示的标的。'

  const alertEmptyMessage =
    alerts.length > 0
      ? ''
      : loadState === 'error' && alertFeed.length === 0
        ? `${loadError} 请点击上方“刷新视图”重试。`
        : loadState !== 'ready' && alertFeed.length === 0
          ? '正在加载预警流...'
          : '当前快照没有待展示的预警。'

  const inspectionEmptyMessage =
    loadState === 'error' && watchlist.length === 0
      ? `${loadError} 请点击上方“刷新视图”重试。`
      : loadState !== 'ready' && watchlist.length === 0
        ? '正在加载标的检查面板...'
        : '当前过滤条件下没有可检查的标的。'

  const isRefreshBusy =
    loadState === 'loading' ||
    loadState === 'refreshing' ||
    ptradeHealth.status === 'loading' ||
    ptradeHealth.status === 'refreshing'

  const ptradeCapabilityLabels = Object.entries(ptradeHealth.capabilities)
    .filter(([, enabled]) => enabled)
    .map(([key]) => {
      switch (key) {
        case 'l2OrderFlow':
          return 'L2 订单流'
        case 'recorder':
          return '录制'
        default:
          return '回放'
      }
    })

  const topBid = ptradeOrderFlow?.bids?.[0] ?? null
  const topAsk = ptradeOrderFlow?.asks?.[0] ?? null

  return (
    <div className="wyckoff-page">
      <header className="wyckoff-hero">
        <div>
          <p className="wyckoff-kicker">Sprint 1 / Radar MVP</p>
          <h1>Wyckoff 2.0 Radar Console</h1>
          <p className="wyckoff-subtitle">
            先把监控、过滤、预警确认跑通，再逐步接入状态服务、L2 验证和 ptrade 执行。
          </p>
        </div>

        <div className="wyckoff-hero-actions">
          <div className="wyckoff-status-pill">
            <Wifi size={16} />
            <span>{systemStatus.connectionLabel}</span>
          </div>
          <div className="wyckoff-status-pill">
            <Database size={16} />
            <span>{systemStatus.dataSourceLabel}</span>
          </div>
          <div className="wyckoff-status-pill">
            <Signal size={16} />
            <span>ptrade {getPtradeLabel(ptradeHealth.status)}</span>
          </div>
          <button
            className="wyckoff-refresh-button"
            type="button"
            onClick={handleRefresh}
            disabled={isRefreshBusy}
          >
            <RefreshCcw size={16} />
            {isRefreshBusy ? '刷新中...' : '刷新视图'}
          </button>
        </div>
      </header>

      <section className="wyckoff-toolbar">
        <label>
          <span>Phase filter</span>
          <select value={phaseFilter} onChange={handlePhaseChange}>
            {phaseOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>Signal filter</span>
          <select value={statusFilter} onChange={handleStatusChange}>
            {statusOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <div className="wyckoff-toolbar-meta">
          <Clock3 size={16} />
          <span>{getToolbarStatusLabel(loadState, lastUpdated, loadError)}</span>
        </div>
      </section>

      <section className="wyckoff-metric-grid" aria-label="dashboard metrics">
        <article className="wyckoff-metric-card">
          <div>
            <p>Visible symbols</p>
            <strong>{summary.total}</strong>
          </div>
          <Database size={20} />
        </article>

        <article className="wyckoff-metric-card is-actionable">
          <div>
            <p>Actionable candidates</p>
            <strong>{summary.actionable}</strong>
          </div>
          <Crosshair size={20} />
        </article>

        <article className="wyckoff-metric-card is-monitoring">
          <div>
            <p>Need L2 validation</p>
            <strong>{summary.monitoring}</strong>
          </div>
          <Signal size={20} />
        </article>

        <article className="wyckoff-metric-card is-blocked">
          <div>
            <p>Risk vetoed</p>
            <strong>{summary.blocked}</strong>
          </div>
          <ShieldAlert size={20} />
        </article>
      </section>

      <section className="wyckoff-layout">
        <div className="wyckoff-panel wyckoff-panel-table">
          <div className="wyckoff-panel-header">
            <div>
              <p className="wyckoff-panel-kicker">Watchlist matrix</p>
              <h2>FSM candidate board</h2>
            </div>
            <span className="wyckoff-panel-badge">{filteredWatchlist.length} rows</span>
          </div>

          <div className="wyckoff-table-wrap">
            {filteredWatchlist.length > 0 ? (
              <table className="wyckoff-table">
                <thead>
                  <tr>
                    <th>标的</th>
                    <th>阶段</th>
                    <th>冰线 / 小溪</th>
                    <th>现价 / 量能</th>
                    <th>P&amp;F 目标</th>
                    <th>状态</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredWatchlist.map((item) => (
                    <tr key={item.symbol} className={item.symbol === activeSelectedSymbol ? 'is-selected' : ''}>
                      <td>
                        <button
                          type="button"
                          className="wyckoff-symbol-button"
                          onClick={() => handleSelectSymbol(item.symbol)}
                          aria-pressed={item.symbol === activeSelectedSymbol}
                        >
                          <strong>{item.name}</strong>
                          <span>{item.symbol}</span>
                        </button>
                      </td>
                      <td>
                        <span className={`wyckoff-phase-badge ${item.phase.toLowerCase().replace(/\s+/g, '-')}`}>
                          {item.phase}
                        </span>
                        <small>{item.subPhase}</small>
                      </td>
                      <td>
                        <strong>{formatCurrency(item.support)}</strong>
                        <span>{formatCurrency(item.resistance)}</span>
                      </td>
                      <td>
                        <strong>{formatCurrency(item.currentPrice)}</strong>
                        <span>{item.volumeState}</span>
                      </td>
                      <td>
                        <strong>{item.targetPrice ? formatCurrency(item.targetPrice) : '--'}</strong>
                        <span>{item.riskReward ? `${item.riskReward.toFixed(1)} : 1` : '未计算'}</span>
                      </td>
                      <td>
                        <span className={`wyckoff-status-pill-inline ${getStatusTone(item.status)}`}>
                          {getStatusLabel(item.status)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="wyckoff-empty-state">{tableEmptyMessage}</p>
            )}
          </div>
        </div>

        <aside className="wyckoff-side-column">
          <div className="wyckoff-panel">
            <div className="wyckoff-panel-header">
              <div>
                <p className="wyckoff-panel-kicker">Selected symbol</p>
                <h2>Inspection panel</h2>
              </div>
              {selectedCandidate ? (
                <span className={`wyckoff-status-pill-inline ${getStatusTone(selectedCandidate.status)}`}>
                  {getStatusLabel(selectedCandidate.status)}
                </span>
              ) : null}
            </div>

            {selectedCandidate ? (
              <div className="wyckoff-detail-stack">
                <div className="wyckoff-detail-summary">
                  <div className="wyckoff-detail-title">
                    <div>
                      <strong>{selectedCandidate.name}</strong>
                      <span>{selectedCandidate.symbol}</span>
                    </div>
                    <span className={`wyckoff-phase-badge ${selectedCandidate.phase.toLowerCase().replace(/\s+/g, '-')}`}>
                      {selectedCandidate.phase}
                    </span>
                  </div>

                  <div className="wyckoff-detail-tags">
                    <span className={`wyckoff-status-pill-inline ${getValidationTone(selectedCandidate.l2Validation)}`}>
                      {getValidationLabel(selectedCandidate.l2Validation)}
                    </span>
                    <span className="wyckoff-status-pill-inline building">{systemStatus.modeLabel}</span>
                  </div>

                  <p>{selectedCandidate.thesis}</p>
                </div>

                <div className="wyckoff-detail-grid">
                  <article className="wyckoff-detail-card">
                    <span>Entry zone</span>
                    <strong>{formatRange(selectedCandidate.entryZone)}</strong>
                  </article>
                  <article className="wyckoff-detail-card">
                    <span>Hard stop</span>
                    <strong>{selectedCandidate.stopLoss ? formatCurrency(selectedCandidate.stopLoss) : '--'}</strong>
                  </article>
                  <article className="wyckoff-detail-card">
                    <span>P&amp;F target</span>
                    <strong>{selectedCandidate.targetPrice ? formatCurrency(selectedCandidate.targetPrice) : '--'}</strong>
                  </article>
                  <article className="wyckoff-detail-card">
                    <span>Confidence</span>
                    <strong>{selectedCandidate.confidence}%</strong>
                  </article>
                  <article className="wyckoff-detail-card">
                    <span>Risk / Reward</span>
                    <strong>{selectedCandidate.riskReward ? `${selectedCandidate.riskReward.toFixed(1)} : 1` : '未计算'}</strong>
                  </article>
                  <article className="wyckoff-detail-card">
                    <span>Next check</span>
                    <strong>{selectedCandidate.nextCheck}</strong>
                  </article>
                </div>

                <div>
                  <p className="wyckoff-panel-kicker">State timeline</p>
                  <div className="wyckoff-timeline">
                    {selectedCandidate.timeline.map((item) => (
                      <article key={`${selectedCandidate.symbol}-${item.time}-${item.label}`} className="wyckoff-timeline-item">
                        <time>{item.time}</time>
                        <div>
                          <strong>{item.label}</strong>
                          <p>{item.note}</p>
                        </div>
                      </article>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <p className="wyckoff-empty-state">{inspectionEmptyMessage}</p>
            )}
          </div>

          <div className="wyckoff-panel">
            <div className="wyckoff-panel-header">
              <div>
                <p className="wyckoff-panel-kicker">ptrade Phase 1</p>
                <h2>L2 order-flow bridge</h2>
              </div>
              <span className={`wyckoff-status-pill-inline ${getPtradeTone(ptradeHealth.status)}`}>
                {getPtradeLabel(ptradeHealth.status)}
              </span>
            </div>

            <div className="wyckoff-detail-stack">
              <p className="wyckoff-empty-state">{ptradeHealth.message}</p>

              <div className="wyckoff-detail-grid">
                <article className="wyckoff-detail-card">
                  <span>Bridge mode</span>
                  <strong>{ptradeHealth.mode}</strong>
                </article>
                <article className="wyckoff-detail-card">
                  <span>Transport</span>
                  <strong>{ptradeHealth.transport}</strong>
                </article>
                <article className="wyckoff-detail-card">
                  <span>最近检查</span>
                  <strong>{formatDateTime(ptradeHealth.lastCheckedAt)}</strong>
                </article>
                <article className="wyckoff-detail-card">
                  <span>跟踪标的</span>
                  <strong>{activeSelectedSymbol || '--'}</strong>
                </article>
              </div>

              <div className="wyckoff-detail-tags">
                {ptradeCapabilityLabels.length > 0 ? (
                  ptradeCapabilityLabels.map((label) => (
                    <span key={label} className="wyckoff-status-pill-inline monitor">
                      {label}
                    </span>
                  ))
                ) : (
                  <span className="wyckoff-status-pill-inline blocked">能力未就绪</span>
                )}
              </div>

              {ptradeOrderFlow ? (
                <>
                  <div className="wyckoff-detail-grid">
                    <article className="wyckoff-detail-card">
                      <span>最新采样</span>
                      <strong>{formatDateTime(ptradeOrderFlow.capturedAt)}</strong>
                    </article>
                    <article className="wyckoff-detail-card">
                      <span>数据源</span>
                      <strong>{ptradeOrderFlow.source}</strong>
                    </article>
                    <article className="wyckoff-detail-card">
                      <span>委买一</span>
                      <strong>{formatOrderLevel(topBid)}</strong>
                    </article>
                    <article className="wyckoff-detail-card">
                      <span>委卖一</span>
                      <strong>{formatOrderLevel(topAsk)}</strong>
                    </article>
                    <article className="wyckoff-detail-card">
                      <span>盘口失衡</span>
                      <strong>{formatPercent(ptradeOrderFlow.imbalance)}</strong>
                    </article>
                    <article className="wyckoff-detail-card">
                      <span>价差</span>
                      <strong>{ptradeOrderFlow.spreadBps.toFixed(1)} bps</strong>
                    </article>
                  </div>

                  <div className="wyckoff-depth-grid">
                    <article className="wyckoff-detail-card">
                      <span>Bid ladder</span>
                      <ul className="wyckoff-depth-list">
                        {ptradeOrderFlow.bids.slice(0, 3).map((level) => (
                          <li key={`bid-${level.price}`}>
                            <strong>{formatCurrency(level.price)}</strong>
                            <span>{level.volume} / {level.orders} 笔</span>
                          </li>
                        ))}
                      </ul>
                    </article>
                    <article className="wyckoff-detail-card">
                      <span>Ask ladder</span>
                      <ul className="wyckoff-depth-list">
                        {ptradeOrderFlow.asks.slice(0, 3).map((level) => (
                          <li key={`ask-${level.price}`}>
                            <strong>{formatCurrency(level.price)}</strong>
                            <span>{level.volume} / {level.orders} 笔</span>
                          </li>
                        ))}
                      </ul>
                    </article>
                  </div>

                  <div>
                    <p className="wyckoff-panel-kicker">Recent tape</p>
                    <div className="wyckoff-timeline">
                      {ptradeOrderFlow.tape.slice(0, 4).map((item) => (
                        <article key={`${item.time}-${item.side}-${item.price}`} className="wyckoff-timeline-item">
                          <time>{item.time}</time>
                          <div>
                            <strong>{item.side} {formatCurrency(item.price)}</strong>
                            <p>{item.volume} 股</p>
                          </div>
                        </article>
                      ))}
                    </div>
                  </div>
                </>
              ) : (
                <p className="wyckoff-empty-state">{ptradeOrderFlowMessage}</p>
              )}
            </div>
          </div>

          <div className="wyckoff-panel">
            <div className="wyckoff-panel-header">
              <div>
                <p className="wyckoff-panel-kicker">Alert stream</p>
                <h2>Human review queue</h2>
              </div>
              <Bell size={18} />
            </div>

            <div className="wyckoff-alert-list">
              {alerts.length > 0 ? (
                alerts.map((alert) => (
                  <article key={alert.id} className={`wyckoff-alert-card ${alert.acknowledged ? 'is-acknowledged' : ''}`}>
                    <div className="wyckoff-alert-meta">
                      <span>{alert.time}</span>
                      <span>{alert.type}</span>
                    </div>
                    <strong>{alert.symbol}</strong>
                    <p>{alert.message}</p>

                    {!alert.acknowledged ? (
                      <button type="button" onClick={() => handleAcknowledge(alert.id)}>
                        <CheckCircle2 size={16} />
                        标记已确认
                      </button>
                    ) : (
                      <div className="wyckoff-alert-ack">
                        <CheckCircle2 size={16} />
                        已确认
                      </div>
                    )}
                  </article>
                ))
              ) : (
                <p className="wyckoff-empty-state">{alertEmptyMessage}</p>
              )}
            </div>
          </div>

          <div className="wyckoff-panel">
            <div className="wyckoff-panel-header">
              <div>
                <p className="wyckoff-panel-kicker">Sprint 1 scope</p>
                <h2>MVP guardrails</h2>
              </div>
              <Activity size={18} />
            </div>

            <ul className="wyckoff-notes-list">
              <li>
                <TrendingUp size={16} />
                当前只实现状态可视化、过滤、预警确认和 ptrade Phase 1 联调，不接真实行情执行。
              </li>
              <li>
                <AlertTriangle size={16} />
                当前 L2 订单流面板默认来自本地 bridge；真实 ptrade 仍需要单独配置上游连接。
              </li>
              <li>
                <ShieldAlert size={16} />
                风控只展示结果，不执行真实拦截或下单。
              </li>
            </ul>
          </div>
        </aside>
      </section>
    </div>
  )
}

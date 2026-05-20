import { Bell, Clock3, Crosshair, ShieldAlert, Signal, Wifi } from 'lucide-react'

function getCryptoSourceTone(status) {
  switch (status) {
    case 'fresh':
      return 'action'
    case 'connected_no_sample':
    case 'connected_no_payload':
      return 'monitor'
    case 'stale':
    case 'error':
    case 'not_running':
      return 'blocked'
    default:
      return 'building'
  }
}

function getCryptoSourceLabel(status) {
  switch (status) {
    case 'fresh':
      return 'Fresh'
    case 'connected_no_sample':
      return 'Quiet'
    case 'connected_no_payload':
      return 'Connected'
    case 'stale':
      return 'Stale'
    case 'error':
      return 'Error'
    case 'not_running':
      return 'Stopped'
    default:
      return 'Unknown'
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

function formatNumber(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '--'
  }

  return value.toLocaleString('en-US')
}

function formatMinutes(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 'n/a'
  }

  return `${value.toFixed(value >= 10 ? 0 : 1)}m`
}

export function CryptoPhaseCMonitor({ cryptoWatch, loadState, loadError }) {
  const sources = cryptoWatch.sourceSummary.sources
  const sourceIssues = cryptoWatch.attention.sourceIssues
  const bestLong = cryptoWatch.candidateSummary.bestLong
  const snapshotLabel =
    loadState === 'error'
      ? loadError
      : loadState === 'ready'
        ? `BTC Phase C 更新 ${formatDateTime(cryptoWatch.exportedAt || cryptoWatch.generatedAt)}`
        : '正在加载 BTC Phase C 快照'

  return (
    <>
      <section className="wyckoff-toolbar">
        <div className="wyckoff-toolbar-meta">
          <Clock3 size={16} />
          <span>{snapshotLabel}</span>
        </div>
      </section>

      <section className="wyckoff-metric-grid" aria-label="btc phase c metrics">
        <article className="wyckoff-metric-card is-actionable">
          <div>
            <p>Fresh sources</p>
            <strong>{formatNumber(cryptoWatch.sourceSummary.fresh)}</strong>
          </div>
          <Wifi size={20} />
        </article>

        <article className="wyckoff-metric-card is-monitoring">
          <div>
            <p>Quiet sources</p>
            <strong>{formatNumber(cryptoWatch.sourceSummary.quiet)}</strong>
          </div>
          <Signal size={20} />
        </article>

        <article className="wyckoff-metric-card">
          <div>
            <p>Liquidation clusters</p>
            <strong>{formatNumber(cryptoWatch.candidateSummary.liquidationClusters)}</strong>
          </div>
          <Crosshair size={20} />
        </article>

        <article className={`wyckoff-metric-card ${cryptoWatch.sourceSummary.issues > 0 ? 'is-blocked' : 'is-actionable'}`}>
          <div>
            <p>Source issues</p>
            <strong>{formatNumber(cryptoWatch.sourceSummary.issues)}</strong>
          </div>
          <ShieldAlert size={20} />
        </article>
      </section>

      <section className="wyckoff-layout wyckoff-crypto-layout">
        <div className="wyckoff-panel wyckoff-panel-table">
          <div className="wyckoff-panel-header">
            <div>
              <p className="wyckoff-panel-kicker">Source health</p>
              <h2>BTC capture lanes</h2>
            </div>
            <span className="wyckoff-panel-badge">{sources.length} sources</span>
          </div>

          {loadState === 'error' ? (
            <p className="wyckoff-empty-state">{loadError}</p>
          ) : (
            <div className="wyckoff-table-wrap">
              <table className="wyckoff-table">
                <thead>
                  <tr>
                    <th>Source</th>
                    <th>Status</th>
                    <th>Last payload</th>
                  </tr>
                </thead>
                <tbody>
                  {sources.map((source) => (
                    <tr key={source.key}>
                      <td>
                        <strong>{source.label}</strong>
                        <span>{source.key}</span>
                      </td>
                      <td>
                        <span className={`wyckoff-status-pill-inline ${getCryptoSourceTone(source.status)}`}>
                          {getCryptoSourceLabel(source.status)}
                        </span>
                      </td>
                      <td>
                        <strong>{formatMinutes(source.lastDataPayloadAgeMinutes)}</strong>
                        <span>age</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <aside className="wyckoff-side-column">
          <div className="wyckoff-panel">
            <div className="wyckoff-panel-header">
              <div>
                <p className="wyckoff-panel-kicker">Phase C watch</p>
                <h2>Next action</h2>
              </div>
              <span className={`wyckoff-status-pill-inline ${cryptoWatch.sourceSummary.issues > 0 ? 'blocked' : 'monitor'}`}>
                {cryptoWatch.sourceSummary.issues > 0 ? 'Needs fix' : 'Monitoring'}
              </span>
            </div>

            <div className="wyckoff-detail-stack">
              <p className="wyckoff-empty-state">{cryptoWatch.nextAction || '等待 BTC Phase C watch 快照。'}</p>

              <div className="wyckoff-detail-grid">
                <article className="wyckoff-detail-card">
                  <span>BTC liquidations</span>
                  <strong>{formatNumber(cryptoWatch.candidateSummary.btcLiquidationEvents)}</strong>
                </article>
                <article className="wyckoff-detail-card">
                  <span>Long clusters</span>
                  <strong>{formatNumber(cryptoWatch.candidateSummary.longLiquidation)}</strong>
                </article>
                <article className="wyckoff-detail-card">
                  <span>Full sensor</span>
                  <strong>{formatNumber(cryptoWatch.candidateSummary.fullSensorReady)}</strong>
                </article>
                <article className="wyckoff-detail-card">
                  <span>Unreviewed</span>
                  <strong>{formatNumber(cryptoWatch.candidateSummary.unreviewed)}</strong>
                </article>
              </div>
            </div>
          </div>

          <div className="wyckoff-panel">
            <div className="wyckoff-panel-header">
              <div>
                <p className="wyckoff-panel-kicker">Best long cluster</p>
                <h2>Review context</h2>
              </div>
              <Crosshair size={18} />
            </div>

            {bestLong ? (
              <div className="wyckoff-detail-stack">
                <div className="wyckoff-detail-summary">
                  <div className="wyckoff-detail-title">
                    <div>
                      <strong>{bestLong.id}</strong>
                      <span>{formatDateTime(bestLong.center)}</span>
                    </div>
                  </div>

                  <div className="wyckoff-detail-tags">
                    <span className={`wyckoff-status-pill-inline ${bestLong.fullSensorReady ? 'action' : 'monitor'}`}>
                      {bestLong.fullSensorReady ? 'Full sensor' : 'Partial sensor'}
                    </span>
                    {bestLong.reviewMatch ? (
                      <span className="wyckoff-status-pill-inline building">Reviewed</span>
                    ) : (
                      <span className="wyckoff-status-pill-inline monitor">Unmatched</span>
                    )}
                  </div>
                </div>

                <div className="wyckoff-detail-grid">
                  <article className="wyckoff-detail-card">
                    <span>Priority</span>
                    <strong>{bestLong.priority}</strong>
                  </article>
                  <article className="wyckoff-detail-card">
                    <span>Cluster events</span>
                    <strong>{formatNumber(bestLong.clusterEvents)}</strong>
                  </article>
                </div>
              </div>
            ) : (
              <p className="wyckoff-empty-state">当前没有 long liquidation cluster。</p>
            )}
          </div>

          <div className="wyckoff-panel">
            <div className="wyckoff-panel-header">
              <div>
                <p className="wyckoff-panel-kicker">Review-next</p>
                <h2>Queue state</h2>
              </div>
              <Bell size={18} />
            </div>

            <div className="wyckoff-detail-stack">
              <div className="wyckoff-detail-grid">
                <article className="wyckoff-detail-card">
                  <span>Status</span>
                  <strong>{cryptoWatch.reviewNext.status}</strong>
                </article>
                <article className="wyckoff-detail-card">
                  <span>Suggested label</span>
                  <strong>{cryptoWatch.reviewNext.suggestedLabel || '--'}</strong>
                </article>
              </div>

              {sourceIssues.length > 0 ? (
                <div className="wyckoff-alert-list">
                  {sourceIssues.map((issue) => (
                    <article key={issue.key} className="wyckoff-alert-card">
                      <div className="wyckoff-alert-meta">
                        <span>{issue.status}</span>
                        <span>{formatMinutes(issue.lastDataPayloadAgeMinutes)}</span>
                      </div>
                      <strong>{issue.label}</strong>
                      <p>{issue.lastError || 'Source requires attention.'}</p>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="wyckoff-empty-state">没有 source issue；等待新的 unreviewed liquidation cluster。</p>
              )}
            </div>
          </div>
        </aside>
      </section>
    </>
  )
}

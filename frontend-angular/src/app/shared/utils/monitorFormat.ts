export function formatDuration(seconds: number): string {
  const s = Math.max(0, Number(seconds) || 0)
  if (s < 60) return `${s.toFixed(s >= 10 ? 0 : 1)}s`
  const m = Math.floor(s / 60)
  const rem = Math.round(s % 60)
  return `${m}m ${rem}s`
}

export function formatMmSs(seconds: number): string {
  const s = Math.max(0, Math.round(Number(seconds) || 0))
  const m = Math.floor(s / 60)
  const rem = s % 60
  return `${String(m).padStart(2, '0')}:${String(rem).padStart(2, '0')}`
}

export function liveClock(): string {
  const now = new Date()
  return now.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}

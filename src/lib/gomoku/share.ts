// 分享 / 剪贴板工具
import { getMyId } from './useGomoku'

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
      return true
    } catch {
      return false
    }
  }
}

/** 本机战绩摘要（来自 /api/matches?pid=） */
export interface MyRecord {
  total: number
  wins: number
  losses: number
  draws: number
}

/** 拉取本机（设备维度）战绩，失败/无数据返回 null */
export async function fetchMyRecord(): Promise<MyRecord | null> {
  try {
    const pid = getMyId()
    if (!pid) return null
    const r = await fetch(`/api/matches?pid=${encodeURIComponent(pid)}`)
    const d = await r.json()
    const s = d?.summary
    if (!s || typeof s.total !== 'number' || s.total <= 0) return null
    return { total: s.total, wins: s.wins, losses: s.losses, draws: s.draws }
  } catch {
    return null
  }
}

/** 战绩短句：「本机战绩 12胜5负1和 · 胜率67%」，无战绩返回空串 */
export function recordLine(rec: MyRecord | null): string {
  if (!rec || rec.total <= 0) return ''
  const decided = rec.wins + rec.losses
  const rate = decided > 0 ? Math.round((rec.wins / decided) * 100) : 0
  const parts = [`${rec.wins}胜${rec.losses}负`]
  if (rec.draws > 0) parts.push(`${rec.draws}和`)
  return `本机战绩 ${parts.join('')}${decided > 0 ? ` · 胜率${rate}%` : ''}`
}

export function inviteUrl(code: string, from?: string): string {
  const base = typeof window === 'undefined' ? `/?room=${code}` : `${window.location.origin}/?room=${code}`
  if (!from) return base
  return `${base}&from=${encodeURIComponent(from)}`
}

/** 邀请文案：携带邀请人本机战绩（有则附加挑战语气） */
export function inviteText(code: string, rec?: MyRecord | null, from?: string): string {
  const host = (from ?? '').trim()
  const recLine = recordLine(rec ?? null)
  const lines: string[] = []
  if (host) {
    lines.push(`${host} 在「五子」开了房间，邀你五子连珠 ♟`)
    if (recLine) lines.push(`${host} 的${recLine}，敢来挑战吗？`)
  } else {
    lines.push('来和我下五子棋 ♟')
    if (recLine) lines.push(`我的${recLine}，敢来挑战吗？`)
  }
  lines.push(`房号【${code}】`)
  lines.push(`点击链接直接开局：${inviteUrl(code, host || undefined)}`)
  return lines.join('\n')
}

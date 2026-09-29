'use client'

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { rankFromRecord, type RankInfo, type RankRecord } from '@/lib/gomoku/rank'

/** 模块级缓存：pid → 战绩（避免重复请求） */
const recordCache = new Map<string, RankRecord>()
const pending = new Map<string, Promise<RankRecord | null>>()

export async function fetchRankRecord(pid: string): Promise<RankRecord | null> {
  if (!pid) return null
  const hit = recordCache.get(pid)
  if (hit) return hit
  const inflight = pending.get(pid)
  if (inflight) return inflight
  const p = fetch(`/api/rank?pids=${encodeURIComponent(pid)}`)
    .then((r) => r.json())
    .then((d) => {
      const rec = d?.ranks?.[pid]
      if (!rec || typeof rec.total !== 'number' || rec.total <= 0) return null
      const out: RankRecord = { wins: Number(rec.wins) || 0, losses: Number(rec.losses) || 0, draws: Number(rec.draws) || 0 }
      recordCache.set(pid, out)
      return out
    })
    .catch(() => null)
    .finally(() => pending.delete(pid))
  pending.set(pid, p)
  return p
}

/** 清除缓存（对局结束后刷新用） */
export function invalidateRank(pid?: string) {
  if (pid) recordCache.delete(pid)
  else recordCache.clear()
}

/** 段位小徽章：有战绩才显示（黑白石点 + 段位名） */
export function RankBadge({ pid, className = '' }: { pid: string; className?: string }) {
  /** 带 pid 快照，避免 pid 切换时旧段位闪烁 */
  const [rank, setRank] = useState<{ pid: string; info: RankInfo | null } | null>(null)
  useEffect(() => {
    let alive = true
    fetchRankRecord(pid).then((rec) => {
      if (alive) setRank({ pid, info: rec ? rankFromRecord(rec) : null })
    })
    return () => {
      alive = false
    }
  }, [pid])

  if (!pid || !rank || rank.pid !== pid || !rank.info) return null
  const info = rank.info
  return (
    <motion.span
      initial={{ scale: 0.6, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 420, damping: 20 }}
      title={`${info.tier.name} · ${info.tier.motto} · ${info.rp} RP`}
      className={`flex shrink-0 items-center gap-1 rounded-full border border-stone-200 bg-stone-50/80 px-1.5 py-px text-[8px] leading-3 text-stone-500 ${className}`}
    >
      <span
        className="inline-block h-1.5 w-1.5 rounded-full"
        style={{
          background: info.tier.tier >= 6 ? '#1c1917' : info.tier.tier >= 3 ? '#57534e' : '#a8a29e',
        }}
      />
      <span className="hidden sm:inline">{info.tier.name}</span>
    </motion.span>
  )
}

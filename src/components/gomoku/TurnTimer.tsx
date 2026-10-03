'use client'

import { useEffect, useRef, useReducer } from 'react'
import { motion } from 'framer-motion'
import { playTick } from '@/lib/gomoku/sounds'

/** 每步倒计时圆环：用「发射时剩余时间 - 本地接收后流逝时间」推算，避免时钟偏差 */
export function TurnTimer({
  deadline,
  serverTime,
  receivedAt,
  size = 30,
  tickSound = false,
}: {
  deadline: number | null
  serverTime: number
  receivedAt?: number
  size?: number
  /** 自己的回合：剩余 ≤5 秒时每秒嘟味一次 */
  tickSound?: boolean
}) {
  const [, bump] = useReducer((x: number) => x + 1, 0)
  const lastTickSec = useRef<number | null>(null)

  useEffect(() => {
    if (!deadline) return
    const t = setInterval(bump, 500)
    return () => clearInterval(t)
  }, [deadline, bump])

  const nowLocal = Date.now()
  const remaining =
    deadline && serverTime
      ? Math.max(0, deadline - serverTime - (nowLocal - (receivedAt ?? nowLocal)))
      : 0

  const secs = Math.ceil(remaining / 1000)

  // ≤5 秒紧急嘟味（仅自己回合，每秒一次）
  useEffect(() => {
    if (!tickSound || !deadline) return
    if (secs <= 5 && secs > 0 && lastTickSec.current !== secs) {
      lastTickSec.current = secs
      playTick()
    }
    if (secs > 5) lastTickSec.current = null
  }, [tickSound, deadline, secs])

  if (!deadline) return null

  const frac = Math.min(1, remaining / 60000)
  const r = (size - 5) / 2
  const circ = 2 * Math.PI * r
  const urgent = secs <= 10

  return (
    <motion.div
      className="relative inline-flex items-center justify-center"
      animate={urgent ? { scale: [1, 1.12, 1] } : {}}
      transition={{ repeat: Infinity, duration: 1 }}
      aria-label={`剩余 ${secs} 秒`}
    >
      {urgent && (
        <motion.span
          className="absolute -inset-2 rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(225,29,72,0.16) 0%, rgba(225,29,72,0) 72%)' }}
          animate={{ opacity: [0.35, 1, 0.35], scale: [0.85, 1.18, 0.85] }}
          transition={{ repeat: Infinity, duration: 1, ease: 'easeInOut' }}
          aria-hidden
        />
      )}
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--ui-track)" strokeWidth={3} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={urgent ? '#e11d48' : '#1c1917'}
          strokeWidth={3}
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - frac)}
          style={{ transition: 'stroke-dashoffset 0.4s linear' }}
        />
      </svg>
      <span
        className={`absolute text-[9px] font-medium tabular-nums ${
          urgent ? 'animate-pulse text-rose-600' : 'text-stone-500'
        }`}
      >
        {secs}
      </span>
    </motion.div>
  )
}

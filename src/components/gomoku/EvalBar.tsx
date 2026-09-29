'use client'

import { motion } from 'framer-motion'
import { Activity, Minus, TrendingDown, TrendingUp } from 'lucide-react'
import { StoneIcon } from './StoneIcon'

/**
 * 局势评估条（观战视角）：黑方估算胜率随每手更新，
 * 含趋势箭头、中线基准、滑动数值标签
 */
export function EvalBar({
  evals,
  status,
}: {
  evals: number[] // 黑方胜率序列（整数百分比），evals[0]=50
  status: 'playing' | 'ended' | 'waiting'
}) {
  const rate = evals.length ? evals[evals.length - 1] : 50
  const prev = evals.length > 1 ? evals[evals.length - 2] : rate
  const delta = rate - prev
  const Trend = delta >= 1 ? TrendingUp : delta <= -1 ? TrendingDown : Minus
  const trendTone = delta >= 1 ? 'text-stone-800' : delta <= -1 ? 'text-amber-600' : 'text-stone-300'
  const blackLead = rate >= 50

  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      className="rounded-2xl border border-stone-200/80 bg-white/70 px-3 py-2.5"
    >
      <div className="mb-2 flex items-center justify-between text-[10px] text-stone-400">
        <span className="flex items-center gap-1 tracking-widest">
          <Activity className="h-3 w-3" />
          局势评估
        </span>
        <span className="flex items-center gap-1.5">
          <Trend className={`h-3 w-3 ${trendTone}`} />
          <span className={`tabular-nums ${trendTone}`}>
            {delta === 0 ? '持平' : `${delta > 0 ? '+' : ''}${delta}%`}
          </span>
          <span className="text-stone-300">· 黑方视角</span>
        </span>
      </div>

      <div className="relative">
        {/* 底轨（白方区域） */}
        <div className="h-2.5 w-full overflow-hidden rounded-full border border-stone-200/90 bg-white">
          <motion.div
            className="h-full rounded-full bg-stone-900"
            animate={{ width: `${rate}%` }}
            transition={{ type: 'spring', stiffness: 160, damping: 24 }}
          />
        </div>
        {/* 50% 基准虚线 */}
        <div className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2">
          <div className="h-full border-l border-dashed border-stone-400/70" />
        </div>
        {/* 滑动数值标签 */}
        <motion.div
          className="pointer-events-none absolute -top-0.5"
          animate={{ left: `clamp(0px, ${rate}% - 14px, calc(100% - 28px))` }}
          transition={{ type: 'spring', stiffness: 160, damping: 24 }}
        >
          <span
            className={`block rounded-full px-1.5 py-px text-[9px] leading-4 tabular-nums text-white shadow-[0_1px_4px_rgba(28,25,23,0.3)] ${
              blackLead ? 'bg-stone-900' : 'bg-stone-500'
            }`}
          >
            {rate}
          </span>
        </motion.div>
        {status === 'playing' && (
          <motion.span
            className="absolute -bottom-1 h-1.5 w-1.5 rounded-full bg-rose-400"
            animate={{ opacity: [0.4, 1, 0.4] }}
            transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
            style={{ left: `${rate}%`, transform: 'translateX(-50%)' }}
          />
        )}
      </div>

      <div className="mt-1.5 flex items-center justify-between text-[10px] text-stone-400">
        <span className="flex items-center gap-1">
          <StoneIcon color={1} size={10} />
          黑 {rate}%
        </span>
        <span className="text-[9px] text-stone-300">仅供观战参考</span>
        <span className="flex items-center gap-1">
          白 {100 - rate}%
          <StoneIcon color={2} size={10} />
        </span>
      </div>
    </motion.div>
  )
}

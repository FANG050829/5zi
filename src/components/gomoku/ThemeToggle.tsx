'use client'

import { useSyncExternalStore } from 'react'
import { useTheme } from 'next-themes'
import { AnimatePresence, motion } from 'framer-motion'
import { Moon, Sun } from 'lucide-react'

const noopSubscribe = () => () => {}

/** 深/浅色模式切换（极简线框风，太阳/月亮互换带旋转动画） */
export function ThemeToggle({ className = '' }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme()
  const mounted = useSyncExternalStore(noopSubscribe, () => true, () => false)
  const isDark = mounted && resolvedTheme === 'dark'

  return (
    <button
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      aria-label={isDark ? '切换到浅色模式' : '切换到深色模式'}
      title={isDark ? '浅色模式' : '深色模式'}
      className={`flex h-9 w-9 items-center justify-center rounded-xl border border-stone-200 bg-white/70 text-stone-500 backdrop-blur transition-all duration-200 hover:-translate-y-px hover:border-stone-400 hover:text-stone-800 hover:shadow-[0_3px_10px_rgba(28,25,23,0.1)] active:translate-y-0 active:scale-95 ${className}`}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={isDark ? 'sun' : 'moon'}
          className="inline-flex"
          initial={{ rotate: -90, opacity: 0, scale: 0.6 }}
          animate={{ rotate: 0, opacity: 1, scale: 1 }}
          exit={{ rotate: 90, opacity: 0, scale: 0.6 }}
          transition={{ duration: 0.22, ease: 'easeOut' }}
        >
          {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </motion.span>
      </AnimatePresence>
    </button>
  )
}

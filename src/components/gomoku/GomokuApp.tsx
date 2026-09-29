'use client'

import { useSyncExternalStore } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useGomoku, getSavedName, getMyId } from '@/lib/gomoku/useGomoku'
import { Lobby } from './Lobby'
import { GameRoom } from './GameRoom'
import { Skeleton } from '@/components/ui/skeleton'

const noopSubscribe = () => () => {}

export default function GomokuApp() {
  const g = useGomoku()
  const savedName = useSyncExternalStore(noopSubscribe, getSavedName, () => '')
  const mounted = useSyncExternalStore(noopSubscribe, () => true, () => false)

  return (
    <div className="min-h-screen flex flex-col bg-stone-50 text-stone-900">
      <main className="flex-1 flex flex-col">
        <AnimatePresence mode="wait">
          {g.phase === 'connecting' && (
            <motion.div
              key="connecting"
              className="flex-1 flex flex-col items-center justify-center gap-5 px-6"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <div className="flex items-center gap-2">
                <motion.span
                  className="inline-flex"
                  animate={{ y: [0, -4, 0] }}
                  transition={{ repeat: Infinity, duration: 2.4, ease: 'easeInOut' }}
                >
                  <span className="h-4 w-4 rounded-full bg-stone-900" />
                </motion.span>
                <motion.span
                  className="inline-flex"
                  animate={{ y: [0, -4, 0] }}
                  transition={{ repeat: Infinity, duration: 2.4, ease: 'easeInOut', delay: 1.2 }}
                >
                  <span className="h-4 w-4 rounded-full border-2 border-stone-300 bg-[#fdfdfc]" />
                </motion.span>
              </div>
              <p className="text-xs tracking-[0.3em] text-stone-400 uppercase">GOMOKU</p>
              <div className="flex w-full max-w-xs flex-col items-center gap-3">
                <Skeleton className="h-3 w-28 rounded-full" />
                <Skeleton className="h-11 w-full rounded-xl" />
                <Skeleton className="h-11 w-full rounded-xl" />
              </div>
            </motion.div>
          )}

          {g.phase === 'lobby' && mounted && (
            <motion.div
              key="lobby"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.25 }}
              className="flex-1"
            >
              <Lobby
                initialName={savedName}
                pendingCode={g.pendingRoomCode}
                busy={g.busy}
                connected={g.connected}
                online={g.online}
                onCreate={g.createRoom}
                onJoin={g.joinRoom}
                consumePendingJoin={g.consumePendingJoin}
                peekRoom={g.peekRoom}
              />
            </motion.div>
          )}

          {g.phase === 'room' && g.room && (
            <motion.div
              key="room"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.25 }}
              className="flex-1"
            >
              <GameRoom gomoku={g} />
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <footer className="mt-auto border-t border-stone-100 bg-white/60 backdrop-blur-sm">
        <div className="mx-auto max-w-3xl px-6 py-4 flex items-center justify-between text-[11px] text-stone-400">
          <span className="tracking-widest">五子 · 极简 GOMOKU</span>
          <span className="flex items-center gap-1.5">
            <span
              className={`h-1.5 w-1.5 rounded-full ${g.connected ? 'bg-emerald-500' : 'bg-stone-300'}`}
              aria-label={g.connected ? '已连接' : '未连接'}
            />
            {g.connected ? (g.online > 0 ? `服务已连接 · ${g.online} 人在线` : '服务已连接') : '连接中…'}
          </span>
        </div>
        <div className="h-[env(safe-area-inset-bottom)]" />
      </footer>
    </div>
  )
}

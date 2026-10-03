'use client'

import { useSyncExternalStore } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useGomoku, getSavedName, getMyId } from '@/lib/gomoku/useGomoku'
import { Lobby } from './Lobby'
import { GameRoom } from './GameRoom'
import { Skeleton } from '@/components/ui/skeleton'
import { StoneIcon } from './StoneIcon'

const noopSubscribe = () => () => {}

export default function GomokuApp() {
  const g = useGomoku()
  const savedName = useSyncExternalStore(noopSubscribe, getSavedName, () => '')
  const mounted = useSyncExternalStore(noopSubscribe, () => true, () => false)

  return (
    <div className="relative flex min-h-screen flex-col text-stone-900">
      <main className="flex flex-1 flex-col">
        <AnimatePresence mode="wait">
          {g.phase === 'connecting' && (
            <motion.div
              key="connecting"
              className="flex flex-1 flex-col items-center justify-center gap-6 px-6"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            >
              <div className="flex items-center gap-3">
                <motion.span
                  className="inline-flex"
                  animate={{ y: [0, -5, 0] }}
                  transition={{ repeat: Infinity, duration: 2.4, ease: 'easeInOut' }}
                >
                  <StoneIcon color={1} size={16} />
                </motion.span>
                <span className="h-px w-6 bg-stone-200" />
                <motion.span
                  className="inline-flex"
                  animate={{ y: [0, -4, 0] }}
                  transition={{ repeat: Infinity, duration: 2.4, ease: 'easeInOut', delay: 1.2 }}
                >
                  <StoneIcon color={2} size={16} />
                </motion.span>
              </div>
              <div>
                <p className="text-center font-display text-xl font-light tracking-[0.5em] text-stone-700 [text-indent:0.5em]">
                  五子
                </p>
                <p className="mt-1.5 text-center text-[10px] tracking-[0.4em] text-stone-400 uppercase [text-indent:0.4em]">
                  Gomoku
                </p>
              </div>
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
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
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
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
              className="flex-1"
            >
              <GameRoom gomoku={g} />
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <footer className="mt-auto border-t border-stone-100 bg-white/50 backdrop-blur-sm">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4 text-[11px] text-stone-400">
          <span className="flex items-center gap-2 tracking-[0.2em]">
            <StoneIcon color={1} size={9} />
            <StoneIcon color={2} size={9} />
            <span className="ml-1">五子 · 极简 GOMOKU</span>
          </span>
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

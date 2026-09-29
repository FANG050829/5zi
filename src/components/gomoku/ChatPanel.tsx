'use client'

import { useEffect, useRef, useState } from 'react'
import { Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { StoneIcon } from './StoneIcon'
import type { ChatMsg } from '@/lib/gomoku/types'

export type ChatPhase = 'waiting' | 'playing' | 'ended'

/** 快捷短语随对局阶段切换：等待催座 / 对局互动 / 终局社交（终局优先引导再来一局） */
const QUICK_BY_PHASE: Record<ChatPhase, string[]> = {
  waiting: ['好了没～', '准备好了！', '你先坐', '快点呀 😆'],
  playing: ['好棋！', '妙啊', '让我想想', '手滑了…', '危险危险', '稳住'],
  ended: ['再来一局！', '打得漂亮', '承让承让', '下次再战', '换个位置？'],
}

export function ChatPanel({
  chat,
  onSend,
  phase = 'playing',
}: {
  chat: ChatMsg[]
  onSend: (text: string) => void
  phase?: ChatPhase
}) {
  const [text, setText] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chat.length])

  const send = (t: string) => {
    const s = t.trim().slice(0, 200)
    if (!s) return
    onSend(s)
    setText('')
  }

  const quick = QUICK_BY_PHASE[phase] ?? QUICK_BY_PHASE.playing

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-4">
        <div className="space-y-3 py-3">
          {chat.map((m) =>
            m.color === 0 ? (
              <p key={m.id} className="px-2 text-center text-[11px] leading-relaxed text-stone-400">
                — {m.text} —
              </p>
            ) : (
              <div key={m.id} className="flex items-end gap-2">
                <span className="mb-0.5 shrink-0">
                  <StoneIcon color={m.color} size={16} />
                </span>
                <div className="min-w-0">
                  <span className="mb-0.5 block text-[10px] leading-none text-stone-400">{m.from}</span>
                  <p className="w-fit max-w-full break-words rounded-2xl rounded-tl-md border border-stone-100 bg-stone-50 px-3 py-1.5 text-[13px] leading-relaxed text-stone-800 shadow-[0_1px_2px_rgba(28,25,23,0.04)] transition-colors duration-200 hover:bg-stone-100/70">
                    {m.text}
                  </p>
                </div>
                <span className="ml-auto shrink-0 self-end pb-0.5 text-[9px] text-stone-300">
                  {new Date(m.ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            )
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      <div className="border-t border-stone-100 bg-white p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {/* 快捷短语随阶段整体切换：key 触发轻淡入，避免生硬跳动 */}
        <div key={phase} className="quick-phase mb-2 flex flex-wrap gap-1.5">
          {quick.map((q, i) =>
            phase === 'ended' && i === 0 ? (
              <button
                key={q}
                onClick={() => send(q)}
                className="quick-chip rounded-full bg-stone-900 px-2.5 py-1 text-[11px] text-white shadow-[0_2px_8px_-2px_rgba(28,25,23,0.45)] transition-transform duration-150 hover:-translate-y-px hover:bg-stone-700 active:scale-95"
              >
                ♟ {q}
              </button>
            ) : (
              <button
                key={q}
                onClick={() => send(q)}
                className="quick-chip rounded-full border border-stone-200 px-2.5 py-1 text-[11px] text-stone-600"
              >
                {q}
              </button>
            )
          )}
        </div>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            send(text)
          }}
        >
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="说点什么…"
            maxLength={200}
            className="h-10 rounded-xl border-stone-200 bg-stone-50/50 focus-visible:ring-stone-300"
          />
          <Button
            type="submit"
            size="icon"
            className="h-10 w-10 shrink-0 rounded-xl bg-stone-900 transition-all duration-200 enabled:hover:-translate-y-px enabled:hover:bg-stone-700 enabled:hover:shadow-[0_6px_16px_-6px_rgba(28,25,23,0.4)] active:translate-y-0 active:scale-[0.94]"
            aria-label="发送"
          >
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </div>
    </div>
  )
}

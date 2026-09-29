'use client'

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { BadgeCheck, Check, Copy, Link2, QrCode, Share2, Swords, LogOut } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { Button } from '@/components/ui/button'
import { StoneIcon } from './StoneIcon'
import type { RoomState } from '@/lib/gomoku/types'
import { copyText, inviteText, inviteUrl, fetchMyRecord, type MyRecord } from '@/lib/gomoku/share'
import { getSavedName } from '@/lib/gomoku/useGomoku'
import { useToast } from '@/hooks/use-toast'

export function WaitingRoom({ room, onLeave }: { room: RoomState; onLeave?: () => void }) {
  const { toast } = useToast()
  const [copied, setCopied] = useState<'link' | 'text' | null>(null)
  const [record, setRecord] = useState<MyRecord | null>(null)
  /** 再约一局：从大厅「再约」进来时自动复制邀请链接并提示 */
  const [reinvite, setReinvite] = useState<string | null>(null)
  const hostName = getSavedName()
  const url = inviteUrl(room.code, hostName || undefined)

  const text = inviteText(room.code, record, hostName || undefined)

  // 拉取本机战绩，邀请文案附带挑战信息
  useEffect(() => {
    let alive = true
    fetchMyRecord().then((rec) => {
      if (alive) setRecord(rec)
    })
    return () => {
      alive = false
    }
  }, [])

  // 再约一局：读取目标对手 → 自动复制邀请链接 → 展示专属提示（一次性）
  useEffect(() => {
    let target: string | null = null
    try {
      target = sessionStorage.getItem('gomoku:reinvite')
      if (target) sessionStorage.removeItem('gomoku:reinvite')
    } catch {
      return
    }
    if (!target) return
    const t = target
    copyText(inviteUrl(room.code, hostName || undefined)).then((ok) => {
      setReinvite(t)
      toast({ description: ok ? `已复制邀请链接，发给「${t}」即可再战一局` : '房间已建好，请手动复制链接' })
    })
  }, [])

  const doCopy = async (kind: 'link' | 'text') => {
    const ok = await copyText(kind === 'link' ? url : text)
    if (ok) {
      setCopied(kind)
      toast({ description: kind === 'link' ? '链接已复制，去微信粘贴给好友吧' : '邀请文案已复制' })
      setTimeout(() => setCopied(null), 1600)
    } else {
      toast({ title: '复制失败', description: '请手动长按二维码保存', variant: 'destructive' })
    }
  }

  const doShare = async () => {
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({ title: '五子 · 极简对弈', text, url })
        return
      } catch {
        /* 用户取消 */
      }
    }
    doCopy('text')
  }

  const blackWaiting = !room.black
  const whiteWaiting = !room.white

  const seatView = (color: 1 | 2) => {
    const seat = color === 1 ? room.black : room.white
    const waiting = color === 1 ? blackWaiting : whiteWaiting
    return (
      <div className="flex flex-col items-center gap-1.5">
        {waiting ? (
          <motion.span
            className="inline-flex"
            animate={{ y: [0, -3, 0], opacity: [0.5, 1, 0.5] }}
            transition={{ repeat: Infinity, duration: 1.8, ease: 'easeInOut' }}
          >
            <StoneIcon color={0} size={34} />
          </motion.span>
        ) : (
          <StoneIcon color={color} size={34} />
        )}
        <span className={`max-w-20 truncate text-xs ${waiting ? 'text-stone-300' : 'text-stone-700'}`}>
          {seat?.name ?? (color === 1 ? '虚位以待' : '等待好友')}
        </span>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] ${
            color === 1 ? 'bg-stone-900 text-white' : 'border border-stone-200 text-stone-400'
          }`}
        >
          执{color === 1 ? '黑' : '白'}
          {color === 1 ? '先行' : ''}
        </span>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-md px-5 pb-12 pt-10">
      <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
        <div className="mb-8 text-center">
          <p className="text-[11px] uppercase tracking-[0.4em] text-stone-400 [text-indent:0.4em]">房间已就绪</p>
          <h1 className="mt-3 text-4xl font-extralight tracking-[0.45em] text-stone-900 [text-indent:0.45em]">{room.code}</h1>
          <p className="mt-2 text-xs text-stone-400">
            {blackWaiting || whiteWaiting ? '把房号或二维码发给微信好友，加入后自动开局' : '双方就座，即将开局…'}
          </p>
        </div>

        {/* 对局双方 */}
        <div className="mb-8 flex items-center justify-center gap-5">
          {seatView(1)}
          <span className="pb-9 text-sm font-light text-stone-300">vs</span>
          {seatView(2)}
        </div>

        {/* 二维码卡片 */}
        <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,0.03),0_12px_32px_-16px_rgba(28,25,23,0.18)] transition-shadow duration-300">
          <div className="flex items-center justify-center">
            <div className="rounded-xl border border-stone-100 bg-white p-3 shadow-[inset_0_0_0_1px_rgba(28,25,23,0.02)]">
              {url ? (
                <QRCodeSVG value={url} size={148} bgColor="#ffffff" fgColor="#1c1917" level="M" />
              ) : (
                <div className="h-[148px] w-[148px] animate-pulse rounded bg-stone-50" />
              )}
            </div>
          </div>
          <p className="mt-3 text-center text-[11px] leading-relaxed text-stone-400">
            微信内打开本页可长按二维码识别 · 好友扫码或点链接后自动入座
          </p>

          {record && record.total > 0 && (
            <motion.p
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.25 }}
              className="mt-2.5 flex items-center justify-center gap-1 text-center text-[11px] text-stone-500"
            >
              <BadgeCheck className="h-3 w-3 text-emerald-600" />
              邀请文案已附带你本机战绩：{record.wins}胜{record.losses}负
              {record.draws > 0 ? `${record.draws}和` : ''}
            </motion.p>
          )}

          {/* 再约一局专属提示 */}
          {reinvite && (
            <motion.p
              initial={{ opacity: 0, y: 4, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ type: 'spring', stiffness: 320, damping: 22 }}
              className="mt-2.5 flex items-center justify-center gap-1 text-center text-[11px] font-medium text-emerald-700"
            >
              <Swords className="h-3 w-3" />
              为「{reinvite}」再约一局 · 邀请链接已复制，去微信粘贴给他 ♟
            </motion.p>
          )}

          <div className="mt-4 grid grid-cols-3 gap-2">
            <Button
              onClick={() => doCopy('link')}
              variant="outline"
              className={`h-10 rounded-xl text-xs text-stone-700 transition-all duration-200 active:scale-[0.96] ${
                copied === 'link' ? 'border-emerald-200 bg-emerald-50/50' : 'border-stone-200 hover:bg-stone-50'
              }`}
            >
              <motion.span
                key={copied === 'link' ? 'ok-link' : 'icon-link'}
                initial={{ scale: 0.4, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 500, damping: 22 }}
                className="mr-1 inline-flex"
              >
                {copied === 'link' ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Link2 className="h-3.5 w-3.5" />}
              </motion.span>
              复制链接
            </Button>
            <Button
              onClick={() => doCopy('text')}
              variant="outline"
              className={`h-10 rounded-xl text-xs text-stone-700 transition-all duration-200 active:scale-[0.96] ${
                copied === 'text' ? 'border-emerald-200 bg-emerald-50/50' : 'border-stone-200 hover:bg-stone-50'
              }`}
            >
              <motion.span
                key={copied === 'text' ? 'ok-text' : 'icon-text'}
                initial={{ scale: 0.4, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 500, damping: 22 }}
                className="mr-1 inline-flex"
              >
                {copied === 'text' ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
              </motion.span>
              邀请文案
            </Button>
            <Button
              onClick={doShare}
              className="h-10 rounded-xl bg-stone-900 text-xs text-white transition-all duration-200 enabled:hover:-translate-y-px enabled:hover:bg-stone-700 enabled:hover:shadow-[0_6px_16px_-6px_rgba(28,25,23,0.4)] active:translate-y-0 active:scale-[0.96]"
            >
              <Share2 className="mr-1 h-3.5 w-3.5" />
              分享
            </Button>
          </div>
        </div>

        <div className="mt-8 flex items-center justify-center gap-2 text-xs text-stone-400">
          <QrCode className="h-3.5 w-3.5" />
          等待好友加入
          <motion.span animate={{ opacity: [0.2, 1, 0.2] }} transition={{ repeat: Infinity, duration: 1.4 }}>
            …
          </motion.span>
        </div>

        {onLeave && (
          <div className="mt-6 text-center">
            <button
              onClick={onLeave}
              className="inline-flex items-center gap-1 text-xs text-stone-400 underline-offset-4 hover:text-stone-600 hover:underline"
            >
              <LogOut className="h-3 w-3" />
              退出房间
            </button>
          </div>
        )}
      </motion.div>
    </div>
  )
}

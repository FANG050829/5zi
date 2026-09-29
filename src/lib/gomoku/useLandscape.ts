'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * 横屏对局模式：
 * - native：Fullscreen API + screen.orientation.lock('landscape')（Android Chrome/微信 X5、桌面浏览器）
 * - css：CSS rotate(90°) 伪横屏（iOS Safari / 微信 WKWebView 不支持上述 API 时的兜底）
 * - 进入时先尝试原生路径，若 350ms 后视口仍为竖形则自动落到 css 旋转；
 *   css 模式下若用户物理旋转设备转为横形，自动升级回 native 布局（去掉旋转）。
 */
export type LandscapeMode = 'off' | 'native' | 'css'

interface LockableOrientation {
  lock?: (orientation: string) => Promise<void>
  unlock?: () => void
}

interface FullscreenDocument extends Document {
  webkitFullscreenElement?: Element | null
  webkitExitFullscreen?: () => Promise<void>
}

interface FullscreenElement extends HTMLElement {
  webkitRequestFullscreen?: () => Promise<void>
}

export function useLandscape() {
  const [mode, setMode] = useState<LandscapeMode>('off')
  const modeRef = useRef<LandscapeMode>('off')

  const apply = useCallback((next: LandscapeMode) => {
    modeRef.current = next
    setMode(next)
  }, [])

  const exit = useCallback(() => {
    try {
      const so = screen.orientation as ScreenOrientation & LockableOrientation
      so?.unlock?.()
    } catch {
      /* 不支持则忽略 */
    }
    try {
      const doc = document as FullscreenDocument
      if (doc.fullscreenElement || doc.webkitFullscreenElement) {
        void (doc.exitFullscreen ? doc.exitFullscreen() : doc.webkitExitFullscreen?.())
      }
    } catch {
      /* 忽略 */
    }
    document.body.style.overflow = ''
    apply('off')
  }, [apply])

  const enter = useCallback(async () => {
    // 原生全屏（桌面与 Android 生效；iOS iPhone 上 requestFullscreen 不存在）
    try {
      const el = document.documentElement as FullscreenElement
      if (el.requestFullscreen) await el.requestFullscreen()
      else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen()
    } catch {
      /* 用户拒绝或不支持 → 继续尝试方向锁定 / css 兜底 */
    }
    // 方向锁定（失败不影响，视口检测决定最终形态）
    try {
      const so = screen.orientation as ScreenOrientation & LockableOrientation
      await so?.lock?.('landscape')
    } catch {
      /* iOS / 桌面会 reject，忽略 */
    }
    // 等系统应用全屏/旋转后再判断视口形状
    await new Promise((r) => setTimeout(r, 350))
    document.body.style.overflow = 'hidden'
    apply(window.innerWidth > window.innerHeight ? 'native' : 'css')
  }, [apply])

  // Esc 退出原生全屏时同步收起横屏布局
  useEffect(() => {
    const onFsChange = () => {
      const doc = document as FullscreenDocument
      const fsEl = doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null
      if (!fsEl && modeRef.current === 'native') {
        document.body.style.overflow = ''
        apply('off')
      }
    }
    document.addEventListener('fullscreenchange', onFsChange)
    document.addEventListener('webkitfullscreenchange', onFsChange)
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange)
      document.removeEventListener('webkitfullscreenchange', onFsChange)
    }
  }, [apply])

  // css 旋转期间用户物理转横 → 升级为 native 布局
  useEffect(() => {
    const onResize = () => {
      if (modeRef.current === 'css' && window.innerWidth > window.innerHeight) apply('native')
    }
    window.addEventListener('resize', onResize)
    window.addEventListener('orientationchange', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('orientationchange', onResize)
    }
  }, [apply])

  // 卸载兜底：完整退出横屏（全屏/方向锁/滚动）——覆盖「关闭房间回大厅」组件卸载路径
  useEffect(() => {
    return () => {
      try {
        const doc = document as FullscreenDocument
        if (doc.fullscreenElement || doc.webkitFullscreenElement) {
          void (doc.exitFullscreen ? doc.exitFullscreen() : doc.webkitExitFullscreen?.())
        }
      } catch {
        /* 忽略 */
      }
      try {
        ;(screen.orientation as ScreenOrientation & LockableOrientation)?.unlock?.()
      } catch {
        /* 忽略 */
      }
      document.body.style.overflow = ''
    }
  }, [])

  return { mode, active: mode !== 'off', enter, exit }
}

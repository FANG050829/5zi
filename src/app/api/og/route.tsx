import { ImageResponse } from 'next/og'
import { readFile } from 'fs/promises'
import path from 'path'
import type { NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * 动态 OG 链接预览图（1200x630）
 * /api/og                    → 默认卡片
 * /api/og?room=8F8P&from=阿黑 → 邀请卡片（房号 + 邀请人）
 * 中文字形来自系统 Sarasa Mono SC（缺失时优雅降级为无文字图形卡）
 */

const FONT_DIR = '/usr/share/fonts/truetype/chinese'
let fontPromise: Promise<{ regular: Buffer; bold: Buffer } | null> | null = null

function loadFonts() {
  if (!fontPromise) {
    fontPromise = Promise.all([
      readFile(path.join(FONT_DIR, 'SarasaMonoSC-Regular.ttf')),
      readFile(path.join(FONT_DIR, 'SarasaMonoSC-Bold.ttf')),
    ])
      .then(([regular, bold]) => ({ regular, bold }))
      .catch(() => null)
  }
  return fontPromise
}

/** 棋盘图形（SVG data-uri）：局部 7x7 网格 + 黑方连珠残局 */
function boardSvg(): string {
  const S = 7 // 显示 7x7
  const cell = 56
  const pad = cell / 2
  const size = cell * (S - 1) + pad * 2
  const lines: string[] = []
  for (let i = 0; i < S; i++) {
    const p = pad + i * cell
    lines.push(`<line x1="${pad}" y1="${p}" x2="${size - pad}" y2="${p}" stroke="#d6d0c6" stroke-width="1.4"/>`)
    lines.push(`<line x1="${p}" y1="${pad}" x2="${p}" y2="${size - pad}" stroke="#d6d0c6" stroke-width="1.4"/>`)
  }
  // 天元
  const c = (size - 1) / 2
  lines.push(`<circle cx="${c}" cy="${c}" r="3.2" fill="#a8a29e"/>`)
  // 黑方斜五连 + 白子散点
  const stones: [number, number, number][] = [
    [1, 1, 1], [2, 2, 1], [3, 3, 1], [4, 4, 1], [5, 5, 1],
    [2, 1, 2], [1, 3, 2], [3, 2, 2], [4, 3, 2], [5, 4, 2], [2, 5, 2],
  ]
  for (const [col, row, color] of stones) {
    const x = pad + col * cell
    const y = pad + row * cell
    lines.push(
      color === 1
        ? `<circle cx="${x}" cy="${y}" r="21" fill="#1c1917"/>`
        : `<circle cx="${x}" cy="${y}" r="21" fill="#ffffff" stroke="#d6d0c6" stroke-width="1.6"/>`,
    )
  }
  // 胜利五连线
  lines.push(
    `<line x1="${pad + 1 * cell}" y1="${pad + 1 * cell}" x2="${pad + 5 * cell}" y2="${pad + 5 * cell}" stroke="#e11d48" stroke-width="4" stroke-linecap="round" opacity="0.85"/>`,
  )
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}"><rect width="${size}" height="${size}" rx="14" fill="#f5f5f4"/>${lines.join('')}</svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const room = (sp.get('room') ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8)
  const from = (sp.get('from') ?? '').slice(0, 12)
  const fonts = await loadFonts()

  const board = boardSvg()

  const base: React.CSSProperties = fonts
    ? { fontFamily: 'Sarasa', display: 'flex' }
    : { display: 'flex' }

  return new ImageResponse(
    (
      <div
        style={{
          ...base,
          width: '100%',
          height: '100%',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: 'linear-gradient(135deg, #fafaf9 0%, #f0eeea 60%, #e7e2da 100%)',
          padding: '64px 72px',
          position: 'relative',
        }}
      >
        {/* 顶部微光 */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: 220,
            background: 'radial-gradient(ellipse at 20% 0%, rgba(255,255,255,0.9), rgba(255,255,255,0) 70%)',
          }}
        />

        {/* 主体：左棋盘图形 + 右文案 */}
        <div style={{ ...base, alignItems: 'center', gap: 56, flex: 1 }}>
          <img
            src={board}
            alt="棋盘"
            width={340}
            height={340}
            style={{
              borderRadius: 20,
              boxShadow: '0 18px 40px rgba(28,25,23,0.14)',
            }}
          />
          <div style={{ ...base, flexDirection: 'column', gap: 18, alignItems: 'flex-start' }}>
            <div style={{ ...base, alignItems: 'baseline', gap: 18 }}>
              <span style={{ fontSize: 104, fontWeight: 700, color: '#1c1917', letterSpacing: 8 }}>五子</span>
              <span style={{ fontSize: 30, fontWeight: 400, color: '#a8a29e', letterSpacing: 10 }}>GOMOKU</span>
            </div>
            <div style={{ fontSize: 34, color: '#57534e', letterSpacing: 4 }}>极简联机五子棋 · 微信好友对弈</div>
            {room ? (
              <div style={{ ...base, flexDirection: 'column', gap: 14, marginTop: 18, alignItems: 'flex-start' }}>
                <div
                  style={{
                    ...base,
                    alignItems: 'center',
                    gap: 12,
                    background: '#1c1917',
                    color: '#fafaf9',
                    borderRadius: 999,
                    padding: '10px 26px',
                    fontSize: 32,
                    letterSpacing: 6,
                  }}
                >
                  {`房号 ${room}`}
                </div>
                {from ? (
                  <div style={{ fontSize: 30, color: '#44403c' }}>{`${from} 邀请你五子连珠`}</div>
                ) : (
                  <div style={{ fontSize: 30, color: '#44403c' }}>好友邀你入座对弈</div>
                )}
              </div>
            ) : (
              <div style={{ ...base, gap: 12, marginTop: 18, alignItems: 'center' }}>
                <div style={{ ...base, gap: 10, alignItems: 'center', background: '#ffffff', border: '1px solid #e7e5e4', borderRadius: 999, padding: '10px 22px', fontSize: 26, color: '#57534e' }}>
                  <span style={{ width: 18, height: 18, borderRadius: 999, background: '#1c1917', display: 'flex' }} /> 黑先
                </div>
                <div style={{ ...base, gap: 10, alignItems: 'center', background: '#ffffff', border: '1px solid #e7e5e4', borderRadius: 999, padding: '10px 22px', fontSize: 26, color: '#57534e' }}>
                  <span style={{ width: 18, height: 18, borderRadius: 999, background: '#ffffff', border: '1.5px solid #d6d0c6', display: 'flex' }} /> 白后
                </div>
                <div style={{ ...base, gap: 10, alignItems: 'center', background: '#ffffff', border: '1px solid #e7e5e4', borderRadius: 999, padding: '10px 22px', fontSize: 26, color: '#57534e' }}>
                  <span style={{ width: 18, height: 4, borderRadius: 999, background: '#e11d48', display: 'flex' }} /> 五连胜
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 底部信息条 */}
        <div style={{ ...base, justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 24, color: '#a8a29e', letterSpacing: 3 }}>
            {room ? '打开链接即刻入座 · 断线自动重连' : '创建房间 → 分享链接 → 即刻对弈'}
          </div>
          <div style={{ ...base, alignItems: 'center', gap: 10 }}>
            <span style={{ width: 26, height: 26, borderRadius: 999, background: '#1c1917', display: 'flex' }} />
            <span style={{ width: 26, height: 26, borderRadius: 999, background: '#ffffff', border: '2px solid #d6d0c6', display: 'flex' }} />
          </div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      fonts: fonts
        ? [
            { name: 'Sarasa', data: fonts.regular, weight: 400, style: 'normal' },
            { name: 'Sarasa', data: fonts.bold, weight: 700, style: 'normal' },
          ]
        : undefined,
      headers: { 'Cache-Control': 'public, max-age=600' },
    },
  )
}

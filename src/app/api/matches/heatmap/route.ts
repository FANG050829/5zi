import { NextRequest, NextResponse } from 'next/server'
import { getAllMatches } from '@/server/match-store'

export const dynamic = 'force-dynamic'

/**
 * 落子热区聚合（战绩中心「落子热区」卡）：
 * ?pid=设备标识 或 ?name=昵称 → 该玩家所有对局中本人棋子的落点频率
 * 返回 cells[225]（每格落子数）+ stones 总子数 + top 常用点
 */
export async function GET(req: NextRequest) {
  try {
    const pid = (req.nextUrl.searchParams.get('pid') ?? '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64)
    const name = (req.nextUrl.searchParams.get('name') ?? '').replace(/[<>]/g, '').trim().slice(0, 20)
    if (!pid && !name) {
      return NextResponse.json({ ok: false, error: 'pid or name required' }, { status: 400 })
    }

    const rows = (await getAllMatches())
      .filter((m) => (pid ? m.blackPid === pid || m.whitePid === pid : m.blackName === name || m.whiteName === name))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 300)

    const cells = new Array(225).fill(0)
    const blackCells = new Array(225).fill(0)
    const whiteCells = new Array(225).fill(0)
    let stones = 0
    let blackStones = 0
    let whiteStones = 0
    let counted = 0
    for (const m of rows) {
      if (!m.moves) continue
      const myColor: 1 | 2 | null = pid
        ? m.blackPid === pid
          ? 1
          : m.whitePid === pid
            ? 2
            : null
        : m.blackName === name
          ? 1
          : m.whiteName === name
            ? 2
            : null
      if (!myColor) continue
      counted++
      for (const part of m.moves.split(';')) {
        const [idxStr, colorStr] = part.split(',')
        const idx = Number(idxStr)
        const color = Number(colorStr)
        if (!Number.isInteger(idx) || idx < 0 || idx > 224 || color !== myColor) continue
        cells[idx] += 1
        stones++
        if (color === 1) {
          blackCells[idx] += 1
          blackStones++
        } else {
          whiteCells[idx] += 1
          whiteStones++
        }
      }
    }

    let max = 0
    for (const v of cells) if (v > max) max = v
    const top = cells
      .map((v, i) => ({ v, i }))
      .sort((a, b) => b.v - a.v)
      .filter((x) => x.v > 0)
      .slice(0, 3)
      .map((x) => x.i)

    /** 执子拆分聚合（战绩中心「执子热区」黑白双图用） */
    const pack = (arr: number[], total: number) => {
      let m2 = 0
      for (const v of arr) if (v > m2) m2 = v
      const t2 = arr
        .map((v, i) => ({ v, i }))
        .sort((a, b) => b.v - a.v)
        .filter((x) => x.v > 0)
        .slice(0, 3)
        .map((x) => x.i)
      return { cells: arr, stones: total, max: m2, top: t2 }
    }

    return NextResponse.json({
      ok: true,
      cells,
      stones,
      counted,
      max,
      top,
      black: pack(blackCells, blackStones),
      white: pack(whiteCells, whiteStones),
    })
  } catch (e) {
    console.error('[api/matches/heatmap] GET error', e)
    return NextResponse.json({ ok: false, error: 'server error' }, { status: 500 })
  }
}

// 段位系统：由战绩推导棋手段位（纯函数，前后端通用）
// RP（Rank Points）= 胜×3 + 和×1 − 负×1（下限 0，鼓励对弈而非惩罚失利）

export interface RankRecord {
  wins: number
  losses: number
  draws: number
}

export interface RankTier {
  /** 段位序号（0 起） */
  tier: number
  /** 段位名 */
  name: string
  /** 段位小注（一句话气质） */
  motto: string
  /** 达到该段位所需 RP */
  min: number
}

/** 九段位表：从初学到棋神 */
export const RANK_TIERS: RankTier[] = [
  { tier: 0, name: '初学', motto: '棋盘新客', min: 0 },
  { tier: 1, name: '入门', motto: '渐入佳境', min: 3 },
  { tier: 2, name: '棋童', motto: '落子有声', min: 8 },
  { tier: 3, name: '棋士', motto: '攻守有度', min: 16 },
  { tier: 4, name: '高手', motto: '算路深远', min: 28 },
  { tier: 5, name: '棋圣', motto: '连珠如虹', min: 45 },
  { tier: 6, name: '大师', motto: '运筹帷幄', min: 68 },
  { tier: 7, name: '宗师', motto: '登峰造极', min: 100 },
  { tier: 8, name: '棋神', motto: '独孤求败', min: 140 },
]

export interface RankInfo {
  /** 命中段位 */
  tier: RankTier
  /** 当前 RP */
  rp: number
  /** 下一段位（棋神为 null） */
  next: RankTier | null
  /** 距下一级进度 0-1（棋神恒为 1） */
  progress: number
  /** 还差多少 RP 升级（棋神为 0） */
  rpToNext: number
}

/** 由战绩推导段位信息 */
export function rankFromRecord(rec: RankRecord): RankInfo {
  const rp = Math.max(0, rec.wins * 3 + rec.draws - rec.losses)
  let idx = 0
  for (let i = RANK_TIERS.length - 1; i >= 0; i--) {
    if (rp >= RANK_TIERS[i].min) {
      idx = i
      break
    }
  }
  const tier = RANK_TIERS[idx]
  const next = idx + 1 < RANK_TIERS.length ? RANK_TIERS[idx + 1] : null
  const span = next ? next.min - tier.min : 1
  const progress = next ? Math.min(1, Math.max(0, (rp - tier.min) / span)) : 1
  return { tier, rp, next, progress, rpToNext: next ? Math.max(0, next.min - rp) : 0 }
}

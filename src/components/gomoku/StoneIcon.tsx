'use client'

// 极简棋子图标（大厅/列表等小尺寸场景）
// 注意：黑/白棋子是"实体棋子"，使用字面量颜色，不随深色模式反转
export function StoneIcon({ color, size = 20 }: { color: number; size?: number }) {
  if (color === 0) {
    return (
      <span
        className="inline-block rounded-full border border-stone-300 bg-stone-100"
        style={{ width: size, height: size }}
        aria-hidden
      />
    )
  }
  return color === 1 ? (
    <span
      className="inline-block rounded-full bg-[#1c1917] shadow-[inset_0_-1px_2px_rgba(255,255,255,0.25),0_1px_2px_rgba(0,0,0,0.2)]"
      style={{ width: size, height: size }}
      aria-hidden
    />
  ) : (
    <span
      className="inline-block rounded-full border border-black/10 bg-[#fdfdfc] shadow-[0_1px_2px_rgba(0,0,0,0.12)]"
      style={{ width: size, height: size }}
      aria-hidden
    />
  )
}


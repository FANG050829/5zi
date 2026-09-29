import type { Metadata } from 'next'
import GomokuApp from '@/components/gomoku/GomokuApp'

type SearchParams = Promise<{ room?: string; from?: string }>

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'

export async function generateMetadata({ searchParams }: { searchParams: SearchParams }): Promise<Metadata> {
  const { room, from } = await searchParams
  const code = (room ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8)
  const host = (from ?? '').slice(0, 12)

  const title = code ? (host ? `${host} 邀你五子对弈 · 房号 ${code}` : `房号 ${code} · 五子对弈邀请`) : '五子 · 极简联机五子棋'
  const description = code
    ? `${host ? `${host} 在「五子」开了房间，` : ''}房号 ${code}，打开链接即刻入座开战。`
    : '极简画风的联机五子棋，创建房间把链接或二维码发给微信好友，即可立刻对弈。'

  const ogParams = new URLSearchParams()
  if (code) ogParams.set('room', code)
  if (host) ogParams.set('from', host)
  const ogUrl = `/api/og${ogParams.size ? `?${ogParams.toString()}` : ''}`

  return {
    metadataBase: new URL(siteUrl),
    title,
    description,
    openGraph: {
      title,
      description,
      type: 'website',
      images: [{ url: ogUrl, width: 1200, height: 630 }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [ogUrl],
    },
  }
}

export default function Home() {
  return <GomokuApp />
}

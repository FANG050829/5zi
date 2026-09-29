import type { MetadataRoute } from 'next'

// PWA manifest：支持「添加到主屏幕」
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: '五子 · 极简联机五子棋',
    short_name: '五子',
    description: '极简画风的联机五子棋，创建房间把链接发给微信好友，即刻对弈。',
    start_url: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#fafaf9',
    theme_color: '#fafaf9',
    icons: [
      {
        src: '/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
    ],
  }
}

// 自托管构建收尾：把静态资源拷进 standalone 产物（standalone 不自带静态文件）
// 用 Node fs.cpSync 而非 cp -r，保证 Windows / macOS / Linux 行为一致
import { cpSync } from 'node:fs'

cpSync('.next/static', '.next/standalone/.next/static', { recursive: true })
cpSync('public', '.next/standalone/public', { recursive: true })
console.log('standalone 静态资源拷贝完成')

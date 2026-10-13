import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {title:'条件实验室 · 自然语言选股与策略解释器',description:'把选股想法变成可检查、可修改、可追溯的研究条件。',icons:{icon:'/favicon.svg'}};
export default function RootLayout({children}:Readonly<{children:React.ReactNode}>){return <html lang="zh-CN"><body>{children}</body></html>;}

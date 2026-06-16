import { CalendarClock, CloudUpload, Globe2, Info, KeyRound, LockKeyhole, Mail, Settings } from 'lucide-react'
import { Panel } from '../components/Panel'

const tiles = [
  { icon: Settings, title: 'System', detail: 'Cấu hình hệ thống' },
  { icon: CalendarClock, title: 'Date & Time', detail: 'Cài đặt thời gian' },
  { icon: LockKeyhole, title: 'Security', detail: 'Cài đặt bảo mật' },
  { icon: CloudUpload, title: 'Backup & Restore', detail: 'Sao lưu và khôi phục' },
  { icon: Mail, title: 'Email', detail: 'Cài đặt email' },
  { icon: Globe2, title: 'Language', detail: 'Ngôn ngữ' },
  { icon: KeyRound, title: 'Licenses', detail: 'Quản lý bản quyền' },
  { icon: Info, title: 'About', detail: 'Thông tin phần mềm' }
]

export function SettingsPage() {
  return <div className="space-y-5"><div><h1 className="text-2xl font-semibold">Settings</h1><p className="text-sm text-[var(--c-text-dim)]">Cấu hình thiết bị và giao diện</p></div><Panel><div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">{tiles.map((tile) => { const Icon = tile.icon; return <button key={tile.title} className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[rgba(22,34,58,0.72)] p-6 text-center transition hover:border-[var(--c-accent)] hover:bg-[rgba(22,34,58,0.94)]"><Icon className="mx-auto h-8 w-8 text-[var(--c-accent)]" /><div className="mt-4 font-semibold">{tile.title}</div><div className="mt-1 text-xs text-[var(--c-text-dim)]">{tile.detail}</div></button> })}</div></Panel></div>
}

import { Edit2, Link2, Plus } from 'lucide-react'
import { Button } from '../components/Button'
import { DataTable, Column } from '../components/DataTable'
import { Panel } from '../components/Panel'
import { StatusBadge } from '../components/StatusBadge'
import { getDemoUsers } from '../demo/simulator'
import { useI18n } from '../i18n'
import type { UserRow } from '../types'

export function UsersPage() {
  const { pick } = useI18n()
  const rows = getDemoUsers()
  const columns: Array<Column<UserRow>> = [
    { key: 'username', header: pick('Tên đăng nhập', 'Username'), render: (row) => <span className="font-semibold">{row.username}</span> },
    { key: 'name', header: pick('Họ và tên', 'Full name'), render: (row) => row.fullName },
    { key: 'role', header: pick('Vai trò', 'Role'), render: (row) => row.role },
    { key: 'status', header: pick('Trạng thái', 'Status'), render: (row) => <StatusBadge state={row.online ? 'online' : 'offline'} /> },
    { key: 'actions', header: pick('Thao tác', 'Actions'), render: () => <div className="flex gap-2"><Button size="sm" variant="ghost" icon={<Edit2 className="h-4 w-4" />} /><Button size="sm" variant="ghost" icon={<Link2 className="h-4 w-4" />} /></div> }
  ]
  return <div className="space-y-5"><div className="flex items-end justify-between"><div><h1 className="text-2xl font-semibold">{pick('Người dùng', 'Users')}</h1><p className="text-sm text-[var(--c-text-dim)]">{pick('Quản trị tài khoản RBAC', 'RBAC account administration')}</p></div><Button variant="primary" icon={<Plus className="h-4 w-4" />}>{pick('Thêm user', 'Add user')}</Button></div><Panel><DataTable rows={rows} columns={columns} getRowKey={(row) => row.username} /></Panel></div>
}
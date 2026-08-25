import { PROGRAMS_WORKSPACE_V2_ENABLED } from '../../../shared/config'
import type { ProgrammingProject } from '../model/types'

export const PROGRAMS_CANONICAL_PATH = '/eng/programming/programs'
export const PROGRAMS_LEGACY_PATH = '/eng/programming/projects/:projectId/programs'
export const PROGRAMS_WORKSPACE_MODES = ['EDIT', 'LIVE', 'SIMULATE'] as const
export type ProgramsWorkspaceMode = (typeof PROGRAMS_WORKSPACE_MODES)[number]

/**
 * Allowlist deep-link đi qua legacy redirect. Mười field đầu là danh sách đã
 * pin trong `contracts/programming/pgm02_workspace_v1.json` §route.
 *
 * `tab` KHÔNG thuộc danh sách pin: nó là tham số quá độ của R1, nơi PGM-02 vẫn
 * là ba tab của `DesignWorkspacePage` và `/projects/:id/task` là lối vào cũ trỏ
 * thẳng vào tab `execution`. Bỏ nó khỏi allowlist thì lối vào cũ im lặng rơi về
 * tab Chương trình — mất đích deep-link mà hợp đồng không hề yêu cầu bỏ (danh
 * sách pin là mức TỐI THIỂU phải giữ). `T59-807` hợp nhất workbench sẽ xoá tham
 * số này cùng với ba tab.
 */
export const PROGRAMS_PRESERVED_QUERY = [
  'program',
  'pou',
  'mode',
  'line',
  'column',
  'length',
  'node',
  'port',
  'edge',
  'returnTo',
  'tab'
] as const

interface ProgramsPathOptions {
  pou?: string | null
  mode?: ProgramsWorkspaceMode
  /** Query nguồn chỉ được mang qua allowlist ở trên. */
  search?: string | URLSearchParams
  hash?: string
}

function sourceParams(search: string | URLSearchParams | undefined): URLSearchParams {
  if (search instanceof URLSearchParams) return new URLSearchParams(search)
  return new URLSearchParams(search ?? '')
}

function normalizedHash(hash: string | undefined): string {
  if (!hash) return ''
  return hash.startsWith('#') ? hash : `#${hash}`
}

/**
 * Dựng đúng một URL canonical, đồng thời làm biên sanitize cho legacy query.
 * `program` được giữ để tương thích và chỉ làm alias cho `pou` khi `pou` thật
 * sự VẮNG; một `pou=` rỗng/không hợp lệ phải đi tiếp tới resolver để fail
 * closed, không được thay bằng `program` rồi mở nhầm POU.
 */
export function canonicalProgramsPath(projectId: string, options: ProgramsPathOptions = {}): string {
  const source = sourceParams(options.search)
  const query = new URLSearchParams()
  query.set('project', projectId)

  const explicitPou = options.pou !== undefined
  const selectedPou = explicitPou
    ? options.pou
    : source.has('pou')
      ? source.get('pou')
      : source.get('program')
  if (selectedPou !== null && selectedPou !== undefined) query.set('pou', selectedPou)

  query.set('mode', options.mode ?? (source.get('mode') as ProgramsWorkspaceMode | null) ?? 'EDIT')

  for (const key of PROGRAMS_PRESERVED_QUERY) {
    if (key === 'pou' || key === 'mode') continue
    for (const value of source.getAll(key)) query.append(key, value)
  }

  return `${PROGRAMS_CANONICAL_PATH}?${query.toString()}${normalizedHash(options.hash)}`
}

/**
 * Nguồn duy nhất cho mọi producer link đi vào PGM-02. Khi flag rollback tắt,
 * producer quay về workspace hiện hành và Draft server không đổi.
 */
export function programsWorkspacePath(
  projectId: string,
  options: ProgramsPathOptions = {},
  workspaceV2Enabled = PROGRAMS_WORKSPACE_V2_ENABLED
): string {
  if (workspaceV2Enabled) return canonicalProgramsPath(projectId, options)
  const source = sourceParams(options.search)
  const query = new URLSearchParams()
  const selectedPou = options.pou ?? source.get('pou') ?? source.get('program')
  if (selectedPou) query.set('program', selectedPou)
  for (const key of ['line', 'column', 'length', 'node', 'port', 'edge', 'returnTo', 'tab'] as const) {
    for (const value of source.getAll(key)) query.append(key, value)
  }
  const suffix = query.toString()
  return `/eng/programming/projects/${encodeURIComponent(projectId)}/programs${suffix ? `?${suffix}` : ''}${normalizedHash(options.hash)}`
}

export type ProgramsProjectResolution =
  | { kind: 'LOADING' }
  | { kind: 'ERROR' }
  | { kind: 'EMPTY' }
  | { kind: 'CANONICALIZE'; projectId: string }
  | { kind: 'CHOOSE' }
  | { kind: 'NOT_FOUND' }
  | { kind: 'READY'; project: ProgrammingProject }

/** Resolver thuần: không bao giờ dùng Project đầu tiên làm fallback. */
export function resolveProgramsProject(
  status: 'loading' | 'ready' | 'error',
  projects: readonly ProgrammingProject[],
  requestedProjectId: string | null
): ProgramsProjectResolution {
  if (status === 'loading') return { kind: 'LOADING' }
  if (status === 'error') return { kind: 'ERROR' }
  if (requestedProjectId !== null) {
    const project = projects.find((item) => item.projectId === requestedProjectId)
    return project ? { kind: 'READY', project } : { kind: 'NOT_FOUND' }
  }
  if (projects.length === 0) return { kind: 'EMPTY' }
  if (projects.length === 1) return { kind: 'CANONICALIZE', projectId: projects[0].projectId }
  return { kind: 'CHOOSE' }
}

export function isProgramsWorkspaceMode(value: string | null): value is ProgramsWorkspaceMode {
  return value !== null && (PROGRAMS_WORKSPACE_MODES as readonly string[]).includes(value)
}

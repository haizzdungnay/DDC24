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
  'tab',
  /* `T61-405` — ý định chèn khối, mang từ PGM-04 sang PGM-02. Phải nằm trong
     danh sách GIỮ LẠI, nếu không mọi lần dựng lại đường dẫn canonical (đăng
     nhập lại, đổi tab, tải lại trang) sẽ đánh rơi ý định và người dùng hạ cánh
     vào bộ soạn thảo mà không có gì nói khối nào. */
  'insertEntry',
  'insertLibraryRevision'
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
  const mode = options.mode ?? (source.get('mode') as ProgramsWorkspaceMode | null)
  if (mode && isProgramsWorkspaceMode(mode)) query.set('mode', mode)
  for (const key of ['line', 'column', 'length', 'node', 'port', 'edge', 'returnTo', 'tab'] as const) {
    for (const value of source.getAll(key)) query.append(key, value)
  }
  const suffix = query.toString()
  return `/eng/programming/projects/${encodeURIComponent(projectId)}/programs${suffix ? `?${suffix}` : ''}${normalizedHash(options.hash)}`
}

/**
 * So sánh hai URL của workspace theo NGHĨA, không theo thứ tự chuỗi.
 *
 * Route canonical dựng lại địa chỉ bằng `canonicalProgramsPath` rồi so với URL
 * hiện tại để chặn deep-link rác. So bằng `===` thì THỨ TỰ tham số cũng thành
 * một khác biệt: mở một POU ghi `?project=…&mode=EDIT&pou=…` (vì `pou` được
 * `set` vào cuối), còn bản canonical là `?project=…&pou=…&mode=EDIT`. Hai địa
 * chỉ ấy y hệt nhau về nghĩa, nhưng khác chuỗi nên route trả `<Navigate>` —
 * React tháo TOÀN BỘ workspace rồi dựng lại chỉ vì một lần đổi thứ tự query.
 *
 * Hậu quả đo được (`TC-FBD-NAV-001`, `--repeat-each=160 --workers=4`): sau khi
 * tạo POU có `UNMOUNT` rồi `MOUNT` của `DesignWorkspacePage`, focus rơi về
 * `body`, và 1-4 phím `Insert` gõ trong khoảng đó bị nuốt lặng lẽ. Ngoài đời
 * còn mất cả vị trí cuộn và mọi state tạm của trình soạn thảo, mỗi lần mở POU.
 *
 * Phép sanitize vẫn nguyên: tham số lạ bị `canonicalProgramsPath` loại nên hai
 * bên vẫn khác nhau về nghĩa và vẫn bị nắn. Chỉ thứ tự là thôi bị tính.
 */
export function programsUrlsEquivalent(left: string, right: string): boolean {
  const parse = (value: string) => {
    const hashIndex = value.indexOf('#')
    const hash = hashIndex >= 0 ? value.slice(hashIndex) : ''
    const withoutHash = hashIndex >= 0 ? value.slice(0, hashIndex) : value
    const queryIndex = withoutHash.indexOf('?')
    const pathname = queryIndex >= 0 ? withoutHash.slice(0, queryIndex) : withoutHash
    const query = queryIndex >= 0 ? withoutHash.slice(queryIndex + 1) : ''
    /* Sắp xếp theo cặp `key=value`: một key lặp lại (vd. `line`) vẫn phải khớp
     * đủ số lần, nên so tập hợp có lặp chứ không phải tập hợp key. */
    const pairs = [...new URLSearchParams(query).entries()]
      .map(([key, item]) => `${key}=${item}`)
      .sort()
      .join('&')
    return `${pathname}?${pairs}${hash}`
  }
  return parse(left) === parse(right)
}

export type ProgramsProjectResolution =
  | { kind: 'LOADING' }
  | { kind: 'ERROR' }
  | { kind: 'EMPTY' }
  | { kind: 'CANONICALIZE'; projectId: string }
  | { kind: 'CHOOSE' }
  | { kind: 'NOT_FOUND' }
  | { kind: 'READY'; project: ProgrammingProject }

/**
 * Resolver thuần: không bao giờ dùng Project đầu tiên làm fallback.
 *
 * `status === 'loading'` có HAI nghĩa rất khác nhau: "chưa có gì để hiện" và
 * "đang làm mới thứ đang hiện". Trả `LOADING` cho cả hai thì mỗi lần danh sách
 * Project được nạp lại nền, route đổi nhánh render và React THÁO TOÀN BỘ
 * workspace rồi dựng lại — mất focus bàn phím, mất vị trí cuộn, và mất luôn
 * phím người dùng gõ trong khoảng đó. Đo được ở `TC-FBD-NAV-001`
 * (`--repeat-each=160 --workers=4`): `UNMOUNT` rồi `MOUNT` của cả
 * `DesignWorkspacePage` ngay sau khi tạo POU, kèm 1-4 phím `Insert` có
 * `event.target` là `BODY` nên bị nuốt lặng lẽ.
 *
 * Nên chỉ coi là `LOADING` khi THẬT SỰ chưa có dữ liệu. Lúc đang làm mới mà đã
 * có danh sách cũ, giữ nguyên bề mặt đang mở — và vẫn KHÔNG kết luận
 * `NOT_FOUND` từ bản cũ: một Project vừa tạo có thể chưa kịp vào danh sách.
 */
export function resolveProgramsProject(
  status: 'loading' | 'ready' | 'error',
  projects: readonly ProgrammingProject[],
  requestedProjectId: string | null
): ProgramsProjectResolution {
  const refreshing = status === 'loading' && projects.length > 0
  if (status === 'loading' && !refreshing) return { kind: 'LOADING' }
  if (status === 'error') return { kind: 'ERROR' }
  if (requestedProjectId !== null) {
    const project = projects.find((item) => item.projectId === requestedProjectId)
    if (project) return { kind: 'READY', project }
    return refreshing ? { kind: 'LOADING' } : { kind: 'NOT_FOUND' }
  }
  /* Không có `?project=`: mọi nhánh dưới đây đều ĐIỀU HƯỚNG. Không điều hướng
   * theo một danh sách đang được thay thế. */
  if (refreshing) return { kind: 'LOADING' }
  if (projects.length === 0) return { kind: 'EMPTY' }
  if (projects.length === 1) return { kind: 'CANONICALIZE', projectId: projects[0].projectId }
  return { kind: 'CHOOSE' }
}

export function isProgramsWorkspaceMode(value: string | null): value is ProgramsWorkspaceMode {
  return value !== null && (PROGRAMS_WORKSPACE_MODES as readonly string[]).includes(value)
}

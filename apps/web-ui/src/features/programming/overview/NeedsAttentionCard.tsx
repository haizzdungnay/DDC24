import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, Info, XCircle } from 'lucide-react'
import type { ComponentType, SVGProps } from 'react'
import { useI18n } from '../../../shared/i18n'
import { Panel } from '../../../shared/components/Panel'
import type { OverviewViewModel } from './overviewViewModel'
import { programsWorkspacePath } from '../shared/programsRoute'

/**
 * `T60-204` — danh sách **việc cần chú ý** của PGM-01 (handoff §2 mục *Needs
 * Attention*, `AC-PGM01-03`).
 *
 * KHUYẾT TẬT ĐANG SỬA
 * -------------------
 * `ProgrammingAttentionList` của `OverviewPage` hiện hành điều hướng MỌI mục về
 * đúng một đích cứng `/eng/programming/runtime` (`BUG-016` chỉ sửa được phần
 * "bấm được", không sửa phần "bấm tới đâu"). Hệ quả: một cảnh báo về ánh xạ
 * Điểm ném người dùng sang trang Runtime, nơi không có gì liên quan đến việc họ
 * vừa bấm. Mỗi mục ở đây vì vậy mang một **trang chủ quản** tường minh
 * (`programs` / `mapping` / `commission` / `runtime`) và đích được dựng từ
 * chính trang đó.
 *
 * VÌ SAO KHÔNG DÙNG `shared/semanticState.ts` CHO MỨC ĐỘ
 * -----------------------------------------------------
 * Bảy trạng thái ngữ nghĩa của `T60-104` trả lời *một sự vật đang ở trạng thái
 * nào*; ba mức `fault | warning | info` ở đây trả lời *một thông điệp khẩn tới
 * đâu* — và tập đó không có `info`. Ép `info` thành `unknown` sẽ dán nhãn "chưa
 * đọc được" lên một dữ kiện đã đọc được rất rõ. Ba mức dưới đây vì vậy có bảng
 * riêng, nhưng giữ nguyên luật gốc của README §3: **mỗi mức mang cả icon lẫn
 * chữ**, màu không bao giờ là tín hiệu duy nhất.
 *
 * KHÔNG BỊA ĐÍCH, KHÔNG BỊA THỰC THỂ
 * ----------------------------------
 * Thiếu `projectId` thì ba đích phụ thuộc Project (Chương trình, Điểm & Ánh xạ,
 * Thư viện) không tồn tại; mục vẫn hiện nhưng **không bấm được** và nói rõ vì
 * sao. Thực thể không có tên người-đọc-được thì viết câu giải thích, KHÔNG in
 * UUID thay thế (`AC-PGM01-01`).
 *
 * Lưu ý ranh giới (`PLAN-FE-SHELL-062`): vô hiệu hoá chỉ hợp lệ khi THIẾU ĐIỀU
 * KIỆN. Vô hiệu hoá vì *trang không tồn tại* là một mục không nên có mặt ngay
 * từ đầu — `shellDestinations.test.ts` chặn đúng ca đó.
 */

type Pick = (vi: string, en: string) => string

export type AttentionSeverity = 'fault' | 'warning' | 'info'

/** Trang chủ quản của vấn đề — đích deep-link được dựng từ đây, không viết cứng. */
export type AttentionOwner = 'programs' | 'mapping' | 'commission' | 'runtime'

export interface AttentionItem {
  /** Khoá React; duy nhất kể cả khi nhiều mục dùng chung một `code`. */
  key: string
  /** Mã kỹ thuật — hiện sau thông điệp người-đọc-được (README §5 luật 9). */
  code: string
  severity: AttentionSeverity
  owner: AttentionOwner
  /** Thông điệp người-đọc-được. */
  message: string
  /** Thực thể liên quan; luôn là chữ đọc được, không bao giờ là UUID. */
  entity: string
  /** Việc cần làm tiếp. */
  action: string
  /** Đích deep-link; `null` ⇒ chưa dựng được đích (thiếu Project). */
  route: string | null
  /** Bắt buộc khi `route === null`: không có mục nào xám đi mà im lặng. */
  routeBlockedReason: string | null
}

const SEVERITY_RANK: Record<AttentionSeverity, number> = { fault: 0, warning: 1, info: 2 }

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>

const SEVERITY_META: Record<AttentionSeverity, { icon: IconComponent; label: [string, string]; className: string }> = {
  fault: { icon: XCircle, label: ['Lỗi', 'Fault'], className: 'text-[var(--c-fault-fg)]' },
  warning: { icon: AlertTriangle, label: ['Cảnh báo', 'Warning'], className: 'text-[var(--c-warn-fg)]' },
  info: { icon: Info, label: ['Thông tin', 'Info'], className: 'text-[var(--c-text-dim)]' }
}

export function attentionSeverityLabel(pick: Pick, severity: AttentionSeverity): string {
  return pick(...SEVERITY_META[severity].label)
}

export function attentionOwnerLabel(pick: Pick, owner: AttentionOwner): string {
  switch (owner) {
    case 'programs':
      return pick('Chương trình', 'Programs')
    case 'mapping':
      return pick('Điểm & Ánh xạ', 'Points & Mapping')
    case 'commission':
      return pick('Kiểm tra & Vận hành', 'Check & Commission')
    case 'runtime':
      return pick('Runtime & Bảo trì', 'Runtime & Service')
  }
}

/**
 * Đích canonical của bốn trang chủ quản (`ProgrammingRoutes.PROGRAMMING_WORKSPACE_PATHS`).
 * Ba trang phụ thuộc Project trả `null` khi chưa có `projectId` — trỏ vào một
 * path thiếu tham số sẽ rơi vào `<Route path="*">` và bật ngược về Tổng quan,
 * tức người dùng bấm một mục rồi thấy mình quay lại chỗ cũ.
 */
export function attentionRoute(owner: AttentionOwner, projectId: string | null, query = ''): string | null {
  if (owner === 'runtime') return '/eng/programming/runtime'
  if (!projectId) return null
  if (owner === 'programs') return programsWorkspacePath(projectId, { search: query })
  const suffix = owner === 'mapping' ? 'mapping' : 'commission'
  return `/eng/programming/projects/${projectId}/${suffix}${query}`
}

export interface AttentionInput {
  vm: OverviewViewModel
  /**
   * `runtime.task?.taskId` — thực thể của mục safe-state / task fault. Không có
   * trong view model (`T60-201` cố ý không mang metrics của Task), nên tầng gọi
   * truyền vào. `null` ⇒ dùng câu thay thế, không bịa tên `Control_Main`.
   */
  taskId: string | null
}

/**
 * Dựng danh sách mục cần chú ý từ **dữ kiện server tường minh**. Không suy đoán,
 * không tự chấm điểm sức khoẻ (D-04: server là authority).
 *
 * Sắp `fault → warning → info`; trong cùng mức giữ đúng thứ tự khai báo ở đây
 * (`Array#sort` ổn định từ ES2019), nên thứ tự đọc không đổi giữa hai lần render.
 */
export function buildAttentionItems(pick: Pick, { vm, taskId }: AttentionInput): AttentionItem[] {
  const { core, active, safeState, draft, programs } = vm
  const projectId = vm.projectId
  const items: AttentionItem[] = []

  const programControlledOutputs = pick('các output do Program điều khiển', 'Program-controlled outputs')
  const safeStateEntity = taskId
    ? `${taskId} / ${programControlledOutputs}`
    : pick('Các output do Program điều khiển (chưa có danh sách Point)', 'Program-controlled outputs (Point list unavailable)')

  /* --- Core và tác vụ: trang chủ quản là Runtime & Bảo trì ---------------- */

  // `unknown` = đang tải. Hét lên "không kết nối được Core" trong lúc còn đang
  // đọc là một cảnh báo giả, và cảnh báo giả làm hỏng độ tin của cả danh sách.
  if (core.semantic === 'fault') {
    items.push(item({
      key: 'PRG-CORE-UNAVAILABLE',
      code: 'PRG-CORE-UNAVAILABLE',
      severity: 'fault',
      owner: 'runtime',
      message: pick('Không kết nối được Core.', 'Core is unreachable.'),
      entity: 'Core',
      action: pick('Kiểm tra service/Core và kết nối IPC.', 'Check the service/Core and IPC connection.'),
      projectId,
      pick
    }))
  } else if (core.producerState === 'DEGRADED') {
    items.push(item({
      key: 'PRG-CORE-DEGRADED',
      code: 'PRG-CORE-DEGRADED',
      severity: 'warning',
      owner: 'runtime',
      message: pick('Core đang suy giảm; dữ liệu có thể cũ.', 'Core is degraded; data may be stale.'),
      entity: 'Core',
      action: pick('Chỉ chẩn đoán; mọi mutation runtime đang bị khóa.', 'Diagnose only; runtime mutations are locked.'),
      projectId,
      pick
    }))
  }

  if (active.taskState === 'FAULT') {
    items.push(item({
      key: 'PRG-TASK-FAULT',
      code: 'PRG-TASK-FAULT',
      severity: 'fault',
      owner: 'runtime',
      message: pick('Tác vụ điều khiển đang lỗi (FAULT).', 'The control task is faulted.'),
      entity: taskId ?? pick('Tác vụ điều khiển (chưa đọc được mã)', 'The control task (its id could not be read)'),
      action: pick('Mở Runtime để xem số lần quá giờ và trạng thái tác vụ.', 'Open Runtime to inspect overruns and task state.'),
      projectId,
      pick
    }))
  }

  /* --- Safe-state: HAI mục khác hẳn nhau, khác cả trang chủ quản ---------- */

  if (safeState.active === true) {
    items.push(safeState.noControllerOnly
      ? item({
          key: 'PRG-SAFE-ACTIVE',
          code: 'PRG-SAFE-ACTIVE',
          severity: 'warning',
          // Trang chủ quản là Điểm & Ánh xạ, KHÔNG phải Runtime: nguyên nhân là
          // chưa có ràng buộc nào đưa output của Program ra Point vật lý, và chỗ
          // sửa việc đó là PGM-03. Đây đúng là kiểu deep-link mà `T60-204` sinh
          // ra để chữa.
          owner: 'mapping',
          message: pick(
            'Core giữ AO/DO cục bộ ở safe-state vì chưa có nguồn điều khiển hợp lệ trên mức Default; DO Modbus mở rộng có trạng thái riêng.',
            'Core holds local AO/DO in safe state because no valid controller is active above Default; extended Modbus DO has separate state.'
          ),
          entity: safeStateEntity,
          action: pick(
            'Không chặn Đưa vào vận hành/Khôi phục. Kiểm tra Điểm & Ánh xạ và readback DO Modbus riêng.',
            'Does not block Commission/Restore. Check Points & Mapping and Modbus DO readback separately.'
          ),
          projectId,
          pick
        })
      : item({
          key: 'PRG-SAFE-ACTIVE',
          code: 'PRG-SAFE-ACTIVE',
          severity: 'fault',
          owner: 'runtime',
          message: pick(
            'Safe-state đang tác động do lỗi thật (I/O/dữ liệu cũ/quá giờ); Core chưa cung cấp mã nguyên nhân chi tiết hơn.',
            'Safe-state is active due to a real fault (I/O/stale data/overrun); Core did not provide a more detailed reason code.'
          ),
          entity: safeStateEntity,
          action: pick(
            'Giữ Commission/Restore bị khóa; kiểm tra Core, I/O và alarm trước khi phục hồi.',
            'Keep Commission/Restore locked; inspect Core, I/O, and alarms before recovery.'
          ),
          projectId,
          pick
        }))
  }

  /* --- Từng Program: trang chủ quản là Chương trình (PGM-02) -------------- */

  for (const row of programs.rows) {
    // Nguồn `UNAVAILABLE` nghĩa là chưa đọc được gì từ Core cho dòng này —
    // dựng một cảnh báo từ đó là dựng từ hư không.
    if (row.runtimeStateSource === 'UNAVAILABLE') continue
    const stale = row.runtimeStateSource === 'LAST_KNOWN'
    const entity = row.name ?? pick('Chương trình không có tên trong gói đang vận hành', 'A program with no name in the running package')
    const query = row.objectId ? `?program=${encodeURIComponent(row.objectId)}` : ''

    if (row.runtimeState === 'FAULTED') {
      items.push(item({
        key: `PRG-PROGRAM-FAULTED:${row.key}`,
        code: 'PRG-PROGRAM-FAULTED',
        // Trạng thái đọc từ lần trước KHÔNG được báo cùng mức với trạng thái
        // sống: nó có thể đã hết từ lâu. Hạ mức và nói rõ là giá trị cũ.
        severity: stale ? 'warning' : 'fault',
        owner: 'programs',
        message: stale
          ? pick('Lần đọc gần nhất thấy chương trình này đang lỗi (giá trị cũ, chưa xác nhận lại với Core).', 'The last known reading shows this program faulted (a stale value, not re-confirmed with Core).')
          : pick('Chương trình đang lỗi (FAULTED).', 'This program is faulted.'),
        entity,
        action: pick('Mở Chương trình để xem mã nguồn và chẩn đoán.', 'Open Programs to inspect the source and diagnostics.'),
        projectId,
        query,
        pick
      }))
      continue
    }

    if (row.health === 'DEGRADED') {
      items.push(item({
        key: `PRG-PROGRAM-DEGRADED:${row.key}`,
        code: 'PRG-PROGRAM-DEGRADED',
        severity: 'warning',
        owner: 'programs',
        message: pick('Máy chủ đánh giá chương trình này đang suy giảm.', 'The server rates this program as degraded.'),
        entity,
        action: pick('Mở Chương trình để xem chu kỳ, lỡ nhịp và thời gian chạy.', 'Open Programs to inspect the cycle, missed releases, and execution time.'),
        projectId,
        query,
        pick
      }))
    }
  }

  /* --- Gói đang chạy lệch bảng của Core: chủ quản là Kiểm tra & Vận hành -- */

  const liveOnly = programs.rows.filter((row) => row.origin === 'LIVE_ONLY').length
  if (liveOnly > 0) {
    items.push(item({
      key: 'PRG-PROGRAM-NOT-DECLARED',
      code: 'PRG-PROGRAM-NOT-DECLARED',
      severity: 'warning',
      owner: 'commission',
      // Gộp thành MỘT mục thay vì mỗi Program một mục: các dòng `LIVE_ONLY`
      // không có tên trong gói (đó chính là vấn đề), nên n mục sẽ là n dòng
      // không phân biệt được với nhau.
      message: pick(
        `Core đang chạy ${liveOnly} chương trình không có trong gói đã đưa vào vận hành.`,
        `Core is running ${liveOnly} program(s) that the commissioned package does not declare.`
      ),
      entity: programs.activeLabel ?? pick('Gói đang vận hành (chưa rõ số hiệu)', 'The running package (number unresolved)'),
      action: pick('Mở Kiểm tra & Vận hành để đối chiếu gói đang chạy.', 'Open Check & Commission to reconcile the running package.'),
      projectId,
      pick
    }))
  }

  /* --- Kiểm tra gần nhất: chủ quản là Kiểm tra & Vận hành ----------------- */

  if (draft.checkState === 'FAILED' || draft.checkState === 'TIMED_OUT') {
    items.push(item({
      key: 'PRG-CHECK-FAILED',
      code: 'PRG-CHECK-FAILED',
      // Không phải `fault`: hệ đang chạy không hỏng gì cả, thứ bị chặn là bước
      // kỹ thuật tiếp theo. Xếp trên một Core suy giảm là nói sai mức khẩn.
      severity: 'warning',
      owner: 'commission',
      message: draft.checkState === 'FAILED'
        ? pick('Kiểm tra gần nhất KHÔNG đạt — chưa Đưa vào vận hành được.', 'The latest check FAILED — commissioning is blocked.')
        : pick('Kiểm tra gần nhất hết giờ — kết quả chưa kết luận được.', 'The latest check timed out — its result is undetermined.'),
      entity: draft.label ?? pick('Bản nháp (chưa rõ số hiệu)', 'The draft (number unresolved)'),
      action: pick('Mở Kiểm tra & Vận hành để đọc chẩn đoán.', 'Open Check & Commission to read the diagnostics.'),
      projectId,
      pick
    }))
  }

  /* --- Đọc được Core nhưng không có trạng thái theo Program --------------- */

  if ((core.semantic === 'good' || core.semantic === 'stale') &&
      programs.source === 'UNAVAILABLE' &&
      programs.emptyReason !== 'LOADING') {
    items.push(item({
      key: 'PRG-PROGRAMS-UNAVAILABLE',
      code: 'PRG-PROGRAMS-UNAVAILABLE',
      severity: 'warning',
      owner: 'runtime',
      message: pick(
        'Core đọc được nhưng chưa trả trạng thái theo từng chương trình; bảng Chương trình đang thiếu số liệu sống.',
        'Core is readable but reports no per-program state; the Programs table is missing live data.'
      ),
      entity: 'Core',
      action: pick('Mở Runtime để kiểm tra phiên bản Core và luồng point_snapshot.', 'Open Runtime to check the Core build and the point_snapshot stream.'),
      projectId,
      pick
    }))
  }

  if (programs.truncated) {
    items.push(item({
      key: 'PRG-PROGRAMS-TRUNCATED',
      code: 'PRG-PROGRAMS-TRUNCATED',
      severity: 'info',
      owner: 'runtime',
      message: pick(
        'Core đã cắt danh sách ở trần 32 chương trình — bảng Chương trình chưa đầy đủ.',
        'Core truncated the list at the 32-program limit — the Programs table is incomplete.'
      ),
      entity: 'Core',
      action: pick('Mở Runtime để xem danh sách đầy đủ theo từng tác vụ.', 'Open Runtime for the full per-task listing.'),
      projectId,
      pick
    }))
  }

  /* --- Bản nháp còn việc chưa phát hành: chủ quản là Chương trình --------- */

  if (draft.dirty === true) {
    items.push(item({
      key: 'PRG-DRAFT-DIRTY',
      code: 'PRG-DRAFT-DIRTY',
      severity: 'info',
      owner: 'programs',
      message: pick('Bản nháp còn thay đổi chưa được đưa vào vận hành.', 'The draft holds changes that are not commissioned yet.'),
      entity: draft.label ?? pick('Bản nháp (chưa rõ số hiệu)', 'The draft (number unresolved)'),
      action: pick('Mở Chương trình để hoàn tất rồi chạy Kiểm tra.', 'Open Programs to finish the work, then run a check.'),
      projectId,
      pick
    }))
  }

  return items.sort((left, right) => SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity])
}

function item(args: {
  key: string
  code: string
  severity: AttentionSeverity
  owner: AttentionOwner
  message: string
  entity: string
  action: string
  projectId: string | null
  query?: string
  pick: Pick
}): AttentionItem {
  const route = attentionRoute(args.owner, args.projectId, args.query ?? '')
  return {
    key: args.key,
    code: args.code,
    severity: args.severity,
    owner: args.owner,
    message: args.message,
    entity: args.entity,
    action: args.action,
    route,
    routeBlockedReason: route === null
      ? args.pick(
          `Cần chọn Project trước khi mở ${attentionOwnerLabel(args.pick, args.owner)}`,
          `Pick a project before opening ${attentionOwnerLabel(args.pick, args.owner)}`
        )
      : null
  }
}

/* ------------------------------------------------------------------ *
 * Thẻ                                                                 *
 * ------------------------------------------------------------------ */

/** Số mục hiện sẵn trước khi phải bấm “Xem tất cả”. */
export const ATTENTION_PREVIEW_LIMIT = 3

export function NeedsAttentionCard({ vm, taskId }: AttentionInput) {
  const { pick } = useI18n()
  const navigate = useNavigate()
  const [expanded, setExpanded] = useState(false)
  const items = buildAttentionItems(pick, { vm, taskId })

  // Còn đang đọc thì KHÔNG được kết luận "không có việc cần chú ý" — câu đó là
  // một lời khẳng định, và khẳng định nó trước khi có dữ liệu là nói dối đúng
  // vào lúc người vận hành cần sự thật nhất.
  const stillReading = vm.core.semantic === 'unknown' || vm.programs.emptyReason === 'LOADING'
  const visible = expanded ? items : items.slice(0, ATTENTION_PREVIEW_LIMIT)

  return (
    <Panel title={pick('Việc cần chú ý', 'Attention required')}>
      {items.length === 0 ? (
        <p className="text-sm text-[var(--c-text-dim)]">
          {stillReading
            ? pick('Đang đọc trạng thái — chưa kết luận được có việc cần chú ý hay không.', 'Still reading the state — whether anything needs attention is undetermined.')
            : pick('Không có việc cần chú ý.', 'Nothing needs attention.')}
        </p>
      ) : (
        <>
          <ul className="space-y-2">
            {visible.map((entry) => (
              <li key={entry.key}>
                <AttentionRow item={entry} onOpen={() => { if (entry.route) navigate(entry.route) }} />
              </li>
            ))}
          </ul>
          {items.length > ATTENTION_PREVIEW_LIMIT && (
            <button
              type="button"
              data-testid="attention-show-all"
              aria-expanded={expanded}
              onClick={() => setExpanded((open) => !open)}
              className="mt-2 rounded-[var(--radius)] px-1 text-xs font-semibold text-[var(--c-accent)] underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--c-accent)]"
            >
              {expanded
                ? pick('Thu gọn', 'Show less')
                : pick(`Xem tất cả (${items.length})`, `View all (${items.length})`)}
            </button>
          )}
        </>
      )}
    </Panel>
  )
}

function AttentionRow({ item: entry, onOpen }: { item: AttentionItem; onOpen: () => void }) {
  const { pick } = useI18n()
  const meta = SEVERITY_META[entry.severity]
  const SeverityIcon = meta.icon
  const severityLabel = attentionSeverityLabel(pick, entry.severity)
  const ownerLabel = attentionOwnerLabel(pick, entry.owner)

  const body = (
    <span className="flex items-start gap-2">
      <SeverityIcon className={`mt-0.5 h-4 w-4 shrink-0 ${meta.className}`} aria-hidden="true" />
      <span className="min-w-0">
        {/* Mức độ là CHỮ, không chỉ màu và icon (README §3). */}
        <span className={`mr-1 text-[10px] font-bold uppercase tracking-wide ${meta.className}`}>{severityLabel}</span>
        {/* Thông điệp người-đọc-được trước, mã kỹ thuật sau (README §5 luật 9). */}
        <span className="text-[var(--c-text)]">{entry.message}</span>
        <span className="ml-1 font-mono text-[10px] text-[var(--c-text-dim)]">{entry.code}</span>
        <span className="mt-1 block text-xs text-[var(--c-text-dim)]">
          {pick('Thực thể', 'Entity')}: {entry.entity} · {pick('Hành động', 'Action')}: {entry.action}
        </span>
        {entry.route ? (
          <span className="mt-1 block text-xs font-semibold text-[var(--c-accent)]">
            {pick(`Mở ${ownerLabel} →`, `Open ${ownerLabel} →`)}
          </span>
        ) : (
          <span className="mt-1 block text-xs text-[var(--c-text-dim)]">{entry.routeBlockedReason}</span>
        )}
      </span>
    </span>
  )

  if (!entry.route) {
    return (
      <div
        data-attention-code={entry.code}
        data-attention-owner={entry.owner}
        className="flex w-full items-start rounded-[var(--radius)] border border-[var(--c-border)] p-2 text-left text-sm opacity-70"
      >
        {body}
      </div>
    )
  }

  return (
    <button
      type="button"
      data-attention-code={entry.code}
      data-attention-owner={entry.owner}
      onClick={onOpen}
      className="flex w-full items-start rounded-[var(--radius)] border border-[var(--c-border)] p-2 text-left text-sm transition hover:bg-[var(--c-surface-2)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--c-accent)]"
    >
      {body}
    </button>
  )
}

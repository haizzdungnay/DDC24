import type { ProgramsWorkspaceMode } from './programsRoute'

/**
 * `T59-807` / `PGM02-V22-WP-01` (phần đi cùng `WP-06`) — máy trạng thái
 * `EDIT`/`SIMULATE`/`LIVE` của workspace Programs.
 *
 * Ba luật, và cả ba đều là chống-mất-dữ-liệu hoặc chống-nói-dối:
 *
 * 1. **Chế độ chưa có capability thì nói rõ lý do**, không ẩn khỏi giao diện.
 *    Ẩn đi khiến người dùng tưởng thiết bị không làm được; nói "chưa có trong
 *    increment này" nói đúng sự thật và đúng cả thời điểm nó sẽ có.
 * 2. **Rời `EDIT` khi Draft còn thay đổi chưa lưu là mất dữ liệu.** Buffer soạn
 *    thảo sống trong bộ nhớ của editor; đổi mode là đổi nguồn tài liệu, nên
 *    buffer đó không đi theo. Phải chặn và hỏi.
 * 3. **Không tự hạ cấp.** Yêu cầu một mode không khả dụng KHÔNG được âm thầm
 *    rơi về `EDIT` — người dùng sẽ tưởng mình đang xem LIVE.
 */

export interface ProgramsModeCapability {
  mode: ProgramsWorkspaceMode
  available: boolean
  /** Vì sao chưa dùng được; `null` khi khả dụng. */
  reason: string | null
}

export type ModeSwitchDecision =
  | { kind: 'ALLOW' }
  | { kind: 'SAME_MODE' }
  | { kind: 'UNAVAILABLE'; reason: string }
  | { kind: 'CONFIRM_DISCARD' }

/**
 * Capability của từng mode trong increment hiện tại.
 *
 * `LIVE` và `SIMULATE` chưa khả dụng vì **increment**, không phải vì thiết bị
 * thiếu khả năng: `LIVE` mở ở R2 (`T59-810..813`), `SIMULATE` ở R3
 * (`T59-814..817`). Viết ra ở một chỗ để giao diện, route resolver và test cùng
 * đọc một câu trả lời — trước đây câu đó nằm rải trong `ProgramsWorkspaceRoute`.
 */
export function programsModeCapabilities(
  pick: (vi: string, en: string) => string,
): ProgramsModeCapability[] {
  return [
    { mode: 'EDIT', available: true, reason: null },
    {
      mode: 'LIVE',
      available: false,
      reason: pick(
        'LIVE cần nguồn giá trị runtime của Revision đang chạy — capability đó mở ở increment R2.',
        'LIVE needs the running revision’s runtime value source — that capability ships in increment R2.',
      ),
    },
    {
      mode: 'SIMULATE',
      available: false,
      reason: pick(
        'SIMULATE cần worker mô phỏng chạy trong sandbox — capability đó mở ở increment R3.',
        'SIMULATE needs the sandboxed simulation worker — that capability ships in increment R3.',
      ),
    },
  ]
}

export function programsModeCapability(
  mode: ProgramsWorkspaceMode,
  capabilities: readonly ProgramsModeCapability[],
): ProgramsModeCapability | undefined {
  return capabilities.find((item) => item.mode === mode)
}

/**
 * Quyết định cho một lần đổi mode.
 *
 * `CONFIRM_DISCARD` cố ý đứng SAU `UNAVAILABLE`: hỏi người dùng "bỏ thay đổi
 * chưa lưu?" rồi mới báo "chế độ đó chưa dùng được" là bắt họ trả giá cho một
 * thao tác không bao giờ xảy ra.
 */
export function modeSwitchDecision(input: {
  from: ProgramsWorkspaceMode
  to: ProgramsWorkspaceMode
  draftDirty: boolean
  capabilities: readonly ProgramsModeCapability[]
}): ModeSwitchDecision {
  if (input.from === input.to) return { kind: 'SAME_MODE' }
  const target = programsModeCapability(input.to, input.capabilities)
  if (!target || !target.available) {
    return { kind: 'UNAVAILABLE', reason: target?.reason ?? 'unavailable' }
  }
  if (input.draftDirty) return { kind: 'CONFIRM_DISCARD' }
  return { kind: 'ALLOW' }
}

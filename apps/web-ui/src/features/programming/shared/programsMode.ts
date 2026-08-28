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
 * Capability của từng mode.
 *
 * `T59-814` đổi nguồn sự thật của SIMULATE: trước đây FE tự khai "chưa có ở
 * increment này", nay nó ĐỌC `capabilities.workspaceModes.simulation.supported`
 * từ server. Lý do là một thiết bị có thể thiếu worker mô phỏng dù FE đã biết
 * về R3 — và khi đó câu "sẽ có ở increment sau" là sai với người đang đứng
 * trước thiết bị đó.
 *
 * Thiếu `workspaceModes` (server đời cũ) ⇒ SIMULATE UNAVAILABLE. Không đoán,
 * và tuyệt đối không dựng simulator trong trình duyệt để thay thế.
 */
export function programsModeCapabilities(
  pick: (vi: string, en: string) => string,
  simulation?: { supported: boolean } | null,
): ProgramsModeCapability[] {
  return [
    { mode: 'EDIT', available: true, reason: null },
    /* `T59-811` — LIVE mở ở R2. Nó KHÔNG phải một chế độ soạn thảo khác: nó là
     * cửa sổ đọc gói ĐANG CHẠY, chỉ đọc với **mọi** vai kể cả admin. */
    { mode: 'LIVE', available: true, reason: null },
    simulation?.supported === true
      ? { mode: 'SIMULATE', available: true, reason: null }
      : {
          mode: 'SIMULATE',
          available: false,
          reason: pick(
            'Thiết bị này chưa công bố khả năng Mô phỏng (cần worker mô phỏng chạy trong sandbox).',
            'This controller does not advertise the Simulation capability (a sandboxed simulation worker is required).',
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

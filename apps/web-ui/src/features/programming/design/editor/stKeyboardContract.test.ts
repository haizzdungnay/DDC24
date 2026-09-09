import { describe, expect, it } from 'vitest'
import contract from '../../../../../../../contracts/programming/st_keyboard_commands_v1.json'

/**
 * `ISS-STED-14` / `F-STED-014` — TEST ĐỌC HỢP ĐỒNG, KHÔNG CHÉP TAY DANH SÁCH.
 *
 * Chép danh sách phím vào test là tạo bản khai thứ hai, và bản thứ hai sẽ trôi
 * khỏi hợp đồng đúng vào lúc ai đó sửa một phím — lúc đó test vẫn xanh trong
 * khi hợp đồng và mã nguồn đã nói hai điều khác nhau. Vì vậy mọi khẳng định ở
 * đây đều duyệt từ chính tệp hợp đồng.
 *
 * Phân vai rõ ràng: validator Python (`verify_programming_st_keyboard.py`) đọc
 * `EditorPane.tsx` cùng facade `ProgramsTab.tsx` và đối chiếu hợp đồng với MÃ
 * NGUỒN; tệp này chỉ kiểm các
 * BẤT BIẾN NỘI TẠI của hợp đồng. Đọc mã nguồn ở cả hai nơi là hai đường kiểm
 * cho cùng một việc, và chúng sẽ lệch nhau.
 */

interface Command {
  id: string
  key: string
  context: string
  mutatesDraft: boolean
  description: string
  browserConflict?: string
}

const commands = contract.commands as Command[]
const contexts = contract.contexts as Record<string, string>

describe('hợp đồng phím ST — ISS-STED-14', () => {
  it('hợp đồng có đủ định danh và phiên bản', () => {
    expect(contract.contractId).toBe('PROGRAMMING-ST-KEYBOARD-COMMANDS-V1')
    expect(contract.version).toBe(1)
    expect(commands.length).toBeGreaterThanOrEqual(20)
  })

  it.each(commands)('lệnh `$id` khai ngữ cảnh có định nghĩa', (command) => {
    expect(contexts[command.context], `context '${command.context}' chưa định nghĩa`).toBeTruthy()
  })

  it('không có hai lệnh cùng phím trong cùng ngữ cảnh', () => {
    // Một hợp đồng tự mâu thuẫn: chỉ một lệnh chạy được, và không ai biết cái nào.
    const seen = new Set<string>()
    for (const command of commands) {
      const binding = `${command.context}::${command.key}`
      expect(seen.has(binding), `trùng ${binding}`).toBe(false)
      seen.add(binding)
    }
  })

  it('phím dùng lại ở nhiều ngữ cảnh phải nói rõ ngữ cảnh khác nhau', () => {
    // `Enter` và `Escape` cố ý mang nhiều nghĩa. Điều phải đúng là chúng KHÔNG
    // bao giờ trùng ngữ cảnh — kiểm ở trên — và mỗi lần dùng lại đều có mô tả
    // riêng, để người đọc biết mình đang ở nhánh nào.
    const byKey = new Map<string, Command[]>()
    for (const command of commands) {
      byKey.set(command.key, [...(byKey.get(command.key) ?? []), command])
    }
    for (const [key, group] of byKey) {
      if (group.length === 1) continue
      const descriptions = new Set(group.map((command) => command.description))
      expect(descriptions.size, `phím ${key} dùng lại nhưng mô tả giống hệt nhau`).toBe(group.length)
    }
  })

  it('mọi lệnh sửa Draft đều nằm ở ngữ cảnh có ô gõ', () => {
    // Một phím ghi vào Draft từ một ngữ cảnh chỉ-đọc (hộp tìm kiếm, hộp tới
    // dòng) là một đường sửa mã người dùng không hề chủ ý.
    const editableContexts = new Set(['sourceEditor', 'completionOpen', 'programsTab'])
    for (const command of commands.filter((item) => item.mutatesDraft)) {
      expect(editableContexts.has(command.context), `${command.id} ở ${command.context}`).toBe(true)
    }
  })

  it('mọi xung đột với trình duyệt/hệ điều hành đều được ghi rõ', () => {
    // Danh sách phím mà TRÌNH DUYỆT chiếm trước. Hợp đồng phải nói ra, vì một
    // phím bị nuốt trước khi tới trang thì không phải "phím của chúng ta".
    const browserOwned = new Set(['Control+p', 'Control+f', 'Control+s', 'Control+g', 'F12'])
    for (const command of commands) {
      if (!browserOwned.has(command.key)) continue
      expect(
        command.browserConflict,
        `${command.id} dùng ${command.key} — phím trình duyệt chiếm — mà không ghi xung đột`,
      ).toBeTruthy()
    }
  })

  it('mô tả đủ dài để dùng được, không phải nhãn trống', () => {
    for (const command of commands) {
      expect(command.description.length, `${command.id} mô tả quá ngắn`).toBeGreaterThanOrEqual(20)
    }
  })
})

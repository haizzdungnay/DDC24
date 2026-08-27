import { describe, expect, it } from 'vitest'

import {
  POU_TABS_SURVIVE_RELOAD,
  POU_TAB_LIMIT,
  activatePouTab,
  closePouTab,
  emptyPouTabs,
  isPouTabMissing,
  openPouTab,
  pouTabKey,
  type PouTabsState,
} from './pouTabs'
import type { ProgrammingProgram } from '../../model/types'

/**
 * `T59-821` / `TC-PGM02-TAB-01` — năm điều `UD-PROG-014` để ngỏ, chốt bằng test.
 *
 * Quyết định nằm trong test chứ không chỉ trong văn xuôi: một luật tab chỉ được
 * ghi ở docs sẽ trôi ngay lần refactor đầu tiên, và cái trôi ở đây là buffer
 * chưa lưu của người dùng.
 */

function pou(key: string, patch: Partial<ProgrammingProgram> = {}): ProgrammingProgram {
  return {
    programId: `program-${key}`, objectId: key, name: `POU_${key}`,
    kind: 'PROGRAM', language: 'ST', document: '', ...patch,
  }
}

function openAll(keys: string[], dirty: ReadonlySet<string> = new Set()): PouTabsState {
  return keys.reduce((state, key) => {
    const result = openPouTab(state, pou(key), dirty)
    if (!result.ok) throw new Error(`không mở được ${key}`)
    return result.state
  }, emptyPouTabs())
}

describe('bất biến định danh — objectId, không bao giờ là tên', () => {
  it('đổi tên POU chỉ đổi nhãn, KHÔNG tạo tab thứ hai', () => {
    const opened = openAll(['obj-a'])
    const renamed = openPouTab(opened, pou('obj-a', { name: 'Tên_Mới' }))
    expect(renamed.ok).toBe(true)
    if (!renamed.ok) return
    expect(renamed.state.tabs).toHaveLength(1)
    expect(renamed.state.tabs[0].lastKnownName).toBe('Tên_Mới')
  })

  it('hai POU TRÙNG TÊN là hai tab riêng', () => {
    let state = emptyPouTabs()
    for (const key of ['obj-a', 'obj-b']) {
      const result = openPouTab(state, pou(key, { name: 'Main' }))
      if (!result.ok) throw new Error('không mở được')
      state = result.state
    }
    expect(state.tabs).toHaveLength(2)
  })

  it('tài liệu v1 không có objectId thì lùi về programId, không lùi về tên', () => {
    expect(pouTabKey({ programId: 'p-1', objectId: undefined })).toBe('p-1')
    expect(pouTabKey({ programId: 'p-1', objectId: 'o-1' })).toBe('o-1')
  })

  it('tab bắc qua cả ST lẫn FBD trong cùng một workspace', () => {
    let state = openAll(['obj-st'])
    const fbd = openPouTab(state, pou('obj-fbd', { language: 'FBD' }))
    if (!fbd.ok) throw new Error('không mở được')
    state = fbd.state
    expect(state.tabs.map((tab) => tab.language)).toEqual(['ST', 'FBD'])
  })
})

describe('điều 1 — trần số tab và hành vi khi vượt', () => {
  it(`trần là ${POU_TAB_LIMIT}; vượt thì đóng tab SẠCH ít dùng nhất`, () => {
    const keys = Array.from({ length: POU_TAB_LIMIT }, (_, index) => `obj-${index}`)
    const state = openAll(keys)
    // `obj-0` mở đầu tiên và không được chạm lại ⇒ ít dùng nhất.
    const overflow = openPouTab(state, pou('obj-new'))
    expect(overflow.ok).toBe(true)
    if (!overflow.ok) return
    expect(overflow.evictedKey).toBe('obj-0')
    expect(overflow.state.tabs).toHaveLength(POU_TAB_LIMIT)
    expect(overflow.state.tabs.some((tab) => tab.key === 'obj-0')).toBe(false)
  })

  it('KHÔNG đóng tab bẩn để lấy chỗ — chọn tab sạch kế tiếp', () => {
    const keys = Array.from({ length: POU_TAB_LIMIT }, (_, index) => `obj-${index}`)
    const state = openAll(keys)
    const overflow = openPouTab(state, pou('obj-new'), new Set(['obj-0']))
    expect(overflow.ok).toBe(true)
    if (!overflow.ok) return
    // `obj-0` bẩn nên phải để yên; nạn nhân là tab sạch ít dùng kế tiếp.
    expect(overflow.evictedKey).toBe('obj-1')
    expect(overflow.state.tabs.some((tab) => tab.key === 'obj-0')).toBe(true)
  })

  it('mọi tab đều bẩn ⇒ TỪ CHỐI mở, không vứt công việc của ai', () => {
    const keys = Array.from({ length: POU_TAB_LIMIT }, (_, index) => `obj-${index}`)
    const state = openAll(keys)
    const overflow = openPouTab(state, pou('obj-new'), new Set(keys))
    expect(overflow.ok).toBe(false)
    if (overflow.ok) return
    expect(overflow.reason).toBe('LIMIT_ALL_DIRTY')
  })

  it('mở lại một POU đã có tab KHÔNG tính vào trần', () => {
    const keys = Array.from({ length: POU_TAB_LIMIT }, (_, index) => `obj-${index}`)
    const state = openAll(keys)
    const again = openPouTab(state, pou('obj-3'), new Set(keys))
    expect(again.ok).toBe(true)
    if (!again.ok) return
    expect(again.state.tabs).toHaveLength(POU_TAB_LIMIT)
    expect(again.state.activeKey).toBe('obj-3')
  })
})

describe('điều 2 — đóng tab bẩn phải xác nhận', () => {
  it('tab bẩn chưa xác nhận ⇒ không đóng', () => {
    const state = openAll(['obj-a', 'obj-b'])
    const closed = closePouTab(state, 'obj-a', { dirty: true })
    expect(closed.ok).toBe(false)
    if (closed.ok) return
    expect(closed.reason).toBe('NEEDS_CONFIRM')
  })

  it('đã xác nhận ⇒ đóng', () => {
    const state = openAll(['obj-a', 'obj-b'])
    const closed = closePouTab(state, 'obj-a', { dirty: true, confirmed: true })
    expect(closed.ok).toBe(true)
    if (!closed.ok) return
    expect(closed.state.tabs.map((tab) => tab.key)).toEqual(['obj-b'])
  })

  it('đóng tab đang mở ⇒ về tab dùng gần đây nhất còn lại, không phải tab bên cạnh', () => {
    let state = openAll(['obj-a', 'obj-b', 'obj-c'])
    state = activatePouTab(state, 'obj-a')
    state = activatePouTab(state, 'obj-c')
    const closed = closePouTab(state, 'obj-c')
    expect(closed.ok).toBe(true)
    if (!closed.ok) return
    // Vừa ở `obj-a` trước khi sang `obj-c`, nên đó là chỗ họ mong quay lại.
    expect(closed.state.activeKey).toBe('obj-a')
  })

  it('đóng tab cuối cùng ⇒ không còn tab nào đang mở', () => {
    const state = openAll(['obj-a'])
    const closed = closePouTab(state, 'obj-a')
    expect(closed.ok).toBe(true)
    if (!closed.ok) return
    expect(closed.state.activeKey).toBeNull()
    expect(closed.state.tabs).toHaveLength(0)
  })
})

describe('điều 3 — mode là của TOÀN workspace', () => {
  it('state tab không mang mode nào', () => {
    const state = openAll(['obj-a'])
    // Nếu có ngày ai đó thêm `mode` vào đây thì mỗi tab sẽ có mode riêng, và
    // một tab EDIT nằm cạnh một tab LIVE là đúng thứ `UD-PROG-014` cấm.
    expect(Object.keys(state.tabs[0]).sort()).toEqual(['key', 'language', 'lastKnownName'])
  })
})

describe('điều 4 — tab không sống qua reload', () => {
  it('hằng khai báo tường minh, không để người đọc tự suy', () => {
    expect(POU_TABS_SURVIVE_RELOAD).toBe(false)
  })
})

describe('điều 5 — POU bị xoá ở phiên khác', () => {
  it('tab ở lại và tự khai là không còn tồn tại', () => {
    const state = openAll(['obj-a', 'obj-b'])
    const programs = [pou('obj-a')]
    expect(isPouTabMissing(state.tabs[0], programs)).toBe(false)
    // Tự đóng sẽ che đi chính sự kiện người dùng cần biết: có ai đó vừa xoá
    // POU họ đang mở.
    expect(isPouTabMissing(state.tabs[1], programs)).toBe(true)
    expect(state.tabs).toHaveLength(2)
  })

  it('kích hoạt một key không có tab ⇒ không đổi gì', () => {
    const state = openAll(['obj-a'])
    expect(activatePouTab(state, 'không-tồn-tại')).toBe(state)
  })
})

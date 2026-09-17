import { describe, expect, it } from 'vitest'

import goldenJson from '../../../../../../contracts/programming/fbd/golden/ahu_fan_enable.json'

import { createFbdEditorState, fbdEditorReducer } from './commands'
import type { FbdDocument } from './model'
import {
  USER_POU_RETURN_PORT,
  UserPouInterfaceError,
  userPouNode,
  userPouCatalogEntry,
  userPouPaletteEntry,
  userPouPorts,
  type UserPouInterface,
} from './userPou'

function golden(): FbdDocument {
  return JSON.parse(JSON.stringify(goldenJson)) as FbdDocument
}

function uuid(prefix: number, index: number): string {
  return `${prefix.toString(16).padStart(8, '0')}-0000-4000-8000-${index.toString(16).padStart(12, '0')}`
}

const blend: UserPouInterface = {
  name: 'Blend',
  kind: 'FUNCTION',
  inputs: [
    { name: 'A', dataType: 'REAL' },
    { name: 'B', dataType: 'REAL' },
    { name: 'RATIO', dataType: 'REAL' },
  ],
  returnType: 'REAL',
}

const hysteresis: UserPouInterface = {
  name: 'Hysteresis',
  kind: 'FUNCTION_BLOCK',
  inputs: [
    { name: 'PV', dataType: 'REAL' },
    { name: 'SP', dataType: 'REAL' },
  ],
  outputs: [
    { name: 'Q', dataType: 'BOOL' },
    { name: 'ERR', dataType: 'REAL' },
  ],
}

describe('sinh pin cho POU người dùng (T59-105)', () => {
  it('FUNCTION: pin vào theo đúng thứ tự khai báo, một pin ra là giá trị trả về', () => {
    // Thứ tự pin QUYẾT ĐỊNH thứ tự đối số khi lower. Nếu nó không bám thứ tự khai
    // báo thì cùng một sơ đồ sẽ đổi nghĩa — lỗi im lặng tệ nhất trong FBD.
    const ports = userPouPorts(blend)
    expect(ports.map((port) => port.name)).toEqual(['A', 'B', 'RATIO', USER_POU_RETURN_PORT])
    expect(ports.map((port) => port.direction)).toEqual(['INPUT', 'INPUT', 'INPUT', 'OUTPUT'])
    expect(ports.every((port) => port.dataType === 'REAL')).toBe(true)
  })

  it('userPouCatalogEntry: chuyển đổi POU sang CatalogEntry đúng chuẩn ST editor', () => {
    const fbEntry = userPouCatalogEntry(hysteresis)
    expect(fbEntry.stateful).toBe(true)
    expect(fbEntry.kind).toBe('FUNCTION_BLOCK')
    expect(fbEntry.name).toBe('Hysteresis')
    expect(fbEntry.entryId).toBe('pou:Hysteresis')
    expect(fbEntry.ports.filter((p) => p.direction === 'INPUT').map((p) => p.name)).toEqual(['PV', 'SP'])
    expect(fbEntry.ports.filter((p) => p.direction === 'OUTPUT').map((p) => p.name)).toEqual(['Q', 'ERR'])

    const funcEntry = userPouCatalogEntry(blend)
    expect(funcEntry.stateful).toBe(false)
    expect(funcEntry.kind).toBe('FUNCTION')
    expect(funcEntry.name).toBe('Blend')
    expect(funcEntry.ports.find((p) => p.direction === 'OUTPUT')?.name).toBe(USER_POU_RETURN_PORT)
  })

  it('FUNCTION_BLOCK: giữ đủ pin ra đã khai, không ép thành một giá trị trả về', () => {
    const ports = userPouPorts(hysteresis)
    expect(ports.map((port) => port.name)).toEqual(['PV', 'SP', 'Q', 'ERR'])
    expect(ports.filter((port) => port.direction === 'OUTPUT').map((port) => port.dataType))
      .toEqual(['BOOL', 'REAL'])
  })

  it('từ chối interface mâu thuẫn thay vì sinh pin sai', () => {
    expect(() => userPouPorts({ ...blend, returnType: undefined }))
      .toThrow(UserPouInterfaceError)
    expect(() => userPouPorts({ ...hysteresis, returnType: 'REAL' }))
      .toThrow(UserPouInterfaceError)
    expect(() => userPouPorts({ ...hysteresis, outputs: [] }))
      .toThrow(UserPouInterfaceError)
    // Trùng tên cổng làm dây nối mơ hồ; phải chết trước khi người dùng vẽ xong.
    expect(() => userPouPorts({ ...blend, inputs: [
      { name: 'A', dataType: 'REAL' }, { name: 'A', dataType: 'REAL' },
    ] })).toThrow(UserPouInterfaceError)
    expect(() => userPouPorts({ ...blend, inputs: [
      { name: 'A', dataType: 'REAL' }, { name: 'a', dataType: 'REAL' },
    ] })).toThrow(UserPouInterfaceError)
    // `OUT` là tên dành riêng cho giá trị trả về của FUNCTION.
    expect(() => userPouPorts({ ...blend, inputs: [{ name: 'OUT', dataType: 'REAL' }] }))
      .toThrow(UserPouInterfaceError)
    expect(() => userPouPorts({ ...blend, name: '1 bad POU' })).toThrow(UserPouInterfaceError)
    expect(() => userPouPorts({ ...blend, inputs: [{ name: 'bad-port', dataType: 'REAL' }] }))
      .toThrow(UserPouInterfaceError)
  })

  it('entry palette không đa hình và nêu rõ nguồn thư viện', () => {
    const entry = userPouPaletteEntry(blend)
    // Kiểu của POU do interface quyết định, không phải do người dùng chọn lúc thả.
    expect(entry.polymorphic).toBe(false)
    expect(entry.typeRef).toBe('Blend')
    expect(entry.buildPorts('BOOL').map((port) => port.name))
      .toEqual(['A', 'B', 'RATIO', USER_POU_RETURN_PORT])

    const fromLibrary = userPouPaletteEntry({ ...blend, fromLibrary: true })
    expect(fromLibrary.labelVi).toContain('thư viện')
    expect(fromLibrary.labelEn).toContain('library')

    const review = userPouPaletteEntry({
      ...blend,
      warning: { vi: 'Chưa duyệt', en: 'Not approved' },
    })
    expect(review.warning?.vi).toBe('Chưa duyệt')
  })
})

describe('node POU người dùng đi qua reducer thật', () => {
  it('thêm được, nối được, và undo trả lại đúng trạng thái trước đó', () => {
    const state = createFbdEditorState(golden(), true)
    const networkId = state.document.networks[0].id
    const before = JSON.stringify(state.document)

    const node = userPouNode(blend, {
      nodeId: uuid(0x70000000, 1),
      executionOrder: 0,
      makePortId: (index) => uuid(0x71000000, index + 1),
    })
    const added = fbdEditorReducer(state, { type: 'ADD_NODE', networkId, node })

    const network = added.document.networks.find((item) => item.id === networkId)
    expect(network).toBeDefined()
    const placed = network!.nodes.find((item) => item.id === node.id)
    expect(placed).toBeDefined()
    expect(placed!.typeRef).toBe('Blend')
    expect(placed!.ports.map((port) => port.order)).toEqual([0, 1, 2, 3])
    // Có thông báo cho trình đọc màn hình, không im lặng đổi tài liệu.
    expect(added.announcement).toBeTruthy()

    const undone = fbdEditorReducer(added, { type: 'UNDO' })
    expect(JSON.stringify(undone.document)).toBe(before)

    const redone = fbdEditorReducer(undone, { type: 'REDO' })
    expect(redone.document.networks.find((item) => item.id === networkId)!.nodes
      .some((item) => item.id === node.id)).toBe(true)
  })

  it('chặn thêm node khi chỉ đọc, không sửa tài liệu', () => {
    const state = createFbdEditorState(golden(), false)
    const networkId = state.document.networks[0].id
    const before = JSON.stringify(state.document)
    const node = userPouNode(hysteresis, {
      nodeId: uuid(0x70000000, 2),
      executionOrder: 0,
      makePortId: (index) => uuid(0x72000000, index + 1),
    })
    const rejected = fbdEditorReducer(state, { type: 'ADD_NODE', networkId, node })
    expect(JSON.stringify(rejected.document)).toBe(before)
    expect(rejected.announcement?.code).toBe('no-edit-permission')
  })
})

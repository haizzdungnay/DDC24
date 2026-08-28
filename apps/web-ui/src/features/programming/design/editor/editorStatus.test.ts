import { describe, expect, it } from 'vitest'

import { detectEol, fbdStatusFields, stStatusFields } from './editorStatus'

/**
 * `T59-821` / `TC-PGM02-SB-01` — thanh trạng thái.
 *
 * Trọng tâm của bộ này là **cái không được điền**. `UTF-8`/`LF` đúng trong đa
 * số trường hợp nên một giá trị mặc định sẽ không bao giờ trông sai — và đó
 * chính là lý do nó nguy hiểm.
 */

function valueOf(fields: ReturnType<typeof stStatusFields>, id: string) {
  return fields.find((field) => field.id === id)?.value
}

describe('detectEol — đọc từ buffer, không đoán', () => {
  it('nhận đúng LF, CRLF và CR', () => {
    expect(detectEol('a\nb')).toBe('LF')
    expect(detectEol('a\r\nb')).toBe('CRLF')
    expect(detectEol('a\rb')).toBe('CR')
  })

  it('trộn kiểu là một câu trả lời THẬT và phải nói ra', () => {
    // Trộn thường là dấu vết một tệp đi qua hai hệ điều hành, và nó làm mọi
    // phép so dòng lệch. Làm tròn nó về LF là giấu đúng thứ cần thấy.
    expect(detectEol('a\r\nb\nc')).toBe('MIXED')
  })

  it('chưa có dòng nào ⇒ UNKNOWN, không mặc định LF', () => {
    expect(detectEol('')).toBe('UNKNOWN')
    expect(detectEol('một dòng duy nhất')).toBe('UNKNOWN')
  })
})

describe('thanh trạng thái ST — cấm mặc định UTF-8/LF', () => {
  it('không ai cấp bảng mã ⇒ null ⇒ giao diện hiện "—"', () => {
    const fields = stStatusFields({ line: 3, column: 7, source: 'a\nb', dirty: false })
    expect(valueOf(fields, 'encoding')).toBeNull()
  })

  it('có nguồn thật cấp bảng mã thì hiện đúng nguồn đó', () => {
    const fields = stStatusFields({ line: 1, column: 1, source: 'a\nb', dirty: false, encoding: 'UTF-8' })
    expect(valueOf(fields, 'encoding')).toBe('UTF-8')
  })

  it('EOL suy ra được từ buffer nên nó là giá trị ĐỌC, không phải đoán', () => {
    expect(valueOf(stStatusFields({ line: 1, column: 1, source: 'a\r\nb', dirty: false }), 'eol')).toBe('CRLF')
    expect(valueOf(stStatusFields({ line: 1, column: 1, source: 'a', dirty: false }), 'eol')).toBeNull()
  })

  it('chế độ chèn chưa đọc được ⇒ null, không mặc định INSERT', () => {
    expect(valueOf(stStatusFields({ line: 1, column: 1, source: '', dirty: false }), 'insertMode')).toBeNull()
    expect(valueOf(stStatusFields({ line: 1, column: 1, source: '', dirty: false, overwrite: false }), 'insertMode')).toBe('INSERT')
    expect(valueOf(stStatusFields({ line: 1, column: 1, source: '', dirty: false, overwrite: true }), 'insertMode')).toBe('OVERWRITE')
  })

  it('dòng/cột và cờ bẩn phản ánh đúng đầu vào', () => {
    const fields = stStatusFields({ line: 12, column: 5, source: 'a\nb', dirty: true })
    expect(valueOf(fields, 'position')).toBe('12:5')
    expect(valueOf(fields, 'dirty')).toBe('DIRTY')
  })
})

describe('thanh trạng thái FBD', () => {
  it('canvas chưa báo zoom ⇒ null, không mặc định 100%', () => {
    expect(fbdStatusFields({ language: 'FBD', dirty: false }).find((f) => f.id === 'zoom')?.value).toBeNull()
    expect(fbdStatusFields({ language: 'FBD', dirty: false, zoom: 0 }).find((f) => f.id === 'zoom')?.value).toBeNull()
    expect(fbdStatusFields({ language: 'FBD', dirty: false, zoom: Number.NaN }).find((f) => f.id === 'zoom')?.value).toBeNull()
  })

  it('zoom hợp lệ hiện theo phần trăm', () => {
    expect(fbdStatusFields({ language: 'FBD', dirty: false, zoom: 1.25 }).find((f) => f.id === 'zoom')?.value).toBe('125%')
  })

  it('"chưa biết" và "mất kết nối" là hai câu khác nhau', () => {
    // Gộp chúng là báo mất kết nối cho một thiết bị đang khoẻ.
    expect(fbdStatusFields({ language: 'FBD', dirty: false }).find((f) => f.id === 'connection')?.value).toBeNull()
    expect(fbdStatusFields({ language: 'FBD', dirty: false, connection: 'OFFLINE' }).find((f) => f.id === 'connection')?.value).toBe('OFFLINE')
  })
})

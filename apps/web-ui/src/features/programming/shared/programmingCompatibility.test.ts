import { describe, expect, it } from 'vitest'
import { BUNDLE_COMPATIBILITY, programmingCompatibility } from './programmingCompatibility'
import { PROGRAMMING_LIBRARY_VERSION } from '../api/generated/library_registry'
import { ST_LANGUAGE_PROFILE_VERSION } from '../api/generated/stLanguageProfile'

/** Thiết bị "khớp hoàn toàn" = đúng bộ ba của bundle này. */
function matchingDevice() {
  return { ...BUNDLE_COMPATIBILITY }
}

describe('programmingCompatibility — ISS-STED-19', () => {
  it('khớp cả bộ ba thì cho soạn thảo', () => {
    const verdict = programmingCompatibility(matchingDevice())
    expect(verdict.state).toBe('COMPATIBLE')
    expect(verdict.editingAllowed).toBe(true)
    expect(verdict.mismatches).toEqual([])
  })

  /* TEST ÂM theo đúng tiêu chí nghiệm thu: bundle FE gặp thiết bị mang version
   * thư viện KHÁC. Không phải "cảnh báo rồi vẫn cho gõ" — phải CHẶN.
   *
   * Phiên bản thiết bị được DỰNG TỪ hằng bundle chứ không chép số.
   * `T61-102` bump registry `rev-a.3 -> rev-a.4` một cách có kiểm soát, và bản
   * cũ của test này ghim `expect(PROGRAMMING_LIBRARY_VERSION).toBe('rev-a.3')`
   * nên nó đỏ vì chính cú bump hợp lệ ấy — một test đỏ mà sản phẩm không sai.
   * Bản sao số hiệu ở FE cũng không canh thêm gì: gate layout đã khoá hằng này
   * khớp registry ở cả ba tệp sinh.
   *
   * Điều đang kiểm là HÀNH VI KHI LỆCH, không phải giá trị của hằng — nên dùng
   * hằng để dựng một giá trị khác nó là đúng chỗ, không phải "so test với chính
   * hằng nó đang kiểm". */
  const deviceLibraryVersion = `${PROGRAMMING_LIBRARY_VERSION}-thiết-bị-khác`

  it('bundle gặp thiết bị lệch version thư viện thì chặn soạn thảo và nêu cả hai phiên bản', () => {
    const verdict = programmingCompatibility({
      ...matchingDevice(),
      libraryRegistryVersion: deviceLibraryVersion,
    })

    expect(verdict.state).toBe('MISMATCH')
    expect(verdict.editingAllowed).toBe(false)
    expect(verdict.mismatches).toHaveLength(1)
    expect(verdict.mismatches[0]).toMatchObject({
      field: 'libraryRegistryVersion',
      bundle: PROGRAMMING_LIBRARY_VERSION,
      device: deviceLibraryVersion,
    })
    // Thông báo phải đọc được và nêu CẢ HAI phía — nếu chỉ nói "không tương
    // thích" thì người vận hành không biết bên nào là bên cũ.
    expect(verdict.reason).toContain(PROGRAMMING_LIBRARY_VERSION)
    expect(verdict.reason).toContain(deviceLibraryVersion)
  })

  it('lệch hồ sơ ngôn ngữ ST cũng chặn, và nêu đúng phiên bản hai bên', () => {
    const verdict = programmingCompatibility({ ...matchingDevice(), stLanguageProfileVersion: '2.0.0' })
    expect(verdict.editingAllowed).toBe(false)
    expect(verdict.mismatches[0]).toMatchObject({
      field: 'stLanguageProfileVersion',
      bundle: ST_LANGUAGE_PROFILE_VERSION,
      device: '2.0.0',
    })
  })

  it('lệch targetAbi chặn dù mọi phiên bản chuỗi đều khớp', () => {
    const verdict = programmingCompatibility({ ...matchingDevice(), targetAbi: 3842 })
    expect(verdict.state).toBe('MISMATCH')
    expect(verdict.mismatches.map((item) => item.field)).toEqual(['targetAbi'])
  })

  it('lệch chữ ký hồ sơ dù chuỗi phiên bản trùng vẫn chặn', () => {
    // Đây là ca nguy hiểm nhất: hai bên cùng xưng `1.0.0` nhưng nội dung hồ sơ
    // khác nhau. Chỉ so nhãn phiên bản sẽ bỏ lọt hoàn toàn.
    const verdict = programmingCompatibility({ ...matchingDevice(), stLanguageProfileSha256: 'a'.repeat(64) })
    expect(verdict.editingAllowed).toBe(false)
    expect(verdict.mismatches.map((item) => item.field)).toEqual(['stLanguageProfileSha256'])
  })

  it('gom đủ mọi trường lệch chứ không dừng ở trường đầu tiên', () => {
    const verdict = programmingCompatibility({
      ...matchingDevice(),
      libraryRegistryVersion: deviceLibraryVersion,
      stLanguageProfileVersion: '2.0.0',
      targetAbi: 3842,
    })
    expect(verdict.mismatches.map((item) => item.field).sort()).toEqual(
      ['libraryRegistryVersion', 'stLanguageProfileVersion', 'targetAbi'].sort(),
    )
  })

  /* THIẾU BẰNG CHỨNG ≠ KHỚP. Đây là chỗ dễ sai nhất: `undefined === undefined`
   * là true, nên một phép so ngây thơ sẽ kết luận "khớp" với thiết bị không
   * công bố gì cả. */
  it('thiết bị không công bố khối compatibility thì KHÔNG kiểm chứng được ⇒ chặn', () => {
    for (const absent of [undefined, null]) {
      const verdict = programmingCompatibility(absent)
      expect(verdict.state).toBe('UNVERIFIABLE')
      expect(verdict.editingAllowed).toBe(false)
      expect(verdict.mismatches).toEqual([])
      expect(verdict.reason).toContain('không kiểm chứng được')
    }
  })

  it('thiếu một trường trong bộ ba cũng là không kiểm chứng được, không phải khớp', () => {
    const verdict = programmingCompatibility({ ...matchingDevice(), libraryRegistrySha256: '' })
    expect(verdict.state).toBe('UNVERIFIABLE')
    expect(verdict.editingAllowed).toBe(false)
    expect(verdict.reason).toContain('libraryRegistrySha256')
  })

  it('đang tải là PENDING chứ không phải kết luận, nhưng vẫn chưa cho soạn thảo', () => {
    const verdict = programmingCompatibility(undefined, true)
    expect(verdict.state).toBe('PENDING')
    expect(verdict.editingAllowed).toBe(false)
  })

  /* KHÔNG TỰ HẠ CẤP: không có đường nào để `editingAllowed` thành true khi
   * trạng thái khác COMPATIBLE. Giữ khẳng định này thành test để một "chế độ
   * tương thích" thêm vào sau không lặng lẽ mở lại cổng. */
  it('chỉ COMPATIBLE mới mở cổng soạn thảo', () => {
    const cases = [
      programmingCompatibility(undefined),
      programmingCompatibility(null),
      programmingCompatibility(undefined, true),
      programmingCompatibility({ ...matchingDevice(), libraryRegistryVersion: deviceLibraryVersion }),
      programmingCompatibility({ ...matchingDevice(), compilerProfileId: 'khác' }),
    ]
    for (const verdict of cases) {
      expect(verdict.state).not.toBe('COMPATIBLE')
      expect(verdict.editingAllowed).toBe(false)
    }
  })

  it('bộ ba của bundle lấy từ hằng sinh tự động, không chép tay', () => {
    expect(BUNDLE_COMPATIBILITY.libraryRegistryVersion).toBe(PROGRAMMING_LIBRARY_VERSION)
    expect(BUNDLE_COMPATIBILITY.stLanguageProfileVersion).toBe(ST_LANGUAGE_PROFILE_VERSION)
  })
})

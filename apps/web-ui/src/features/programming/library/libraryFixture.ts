import type { ProgrammingLibraryEntry } from '../model/types'
import { libraryPresentation, type LibraryPresentation } from './libraryPresentation'

/**
 * `T61-203` — MỘT fixture cho cả hai bề mặt thư viện (chỉ dùng trong test).
 *
 * Tiêu chí chấp nhận của `ISS-PGM04-06` là "cùng entry cho cùng text/badge/
 * signature ở PGM-04 và Quick Library". Một phép kiểm parity chỉ có nghĩa khi
 * hai vế xuất phát từ **cùng một payload máy chủ**; nếu mỗi vế tự dựng lấy đối
 * tượng trình bày của nó thì test đang so hai fixture với nhau, không so hai
 * bề mặt.
 *
 * Vì vậy fixture ở đây khai ở tầng HỢP ĐỒNG (`ProgrammingLibraryEntry`, đúng
 * hình dạng `GET /libraries` trả), rồi mới chiếu bằng `libraryPresentation`.
 * Dựng thẳng `LibraryPresentation` bằng tay sẽ bỏ qua đúng phép chiếu đang cần
 * kiểm — và một test bỏ qua thứ nó đang đo thì xanh vĩnh viễn.
 */
export function libraryEntryFixture(
  overrides: Partial<ProgrammingLibraryEntry> = {},
): ProgrammingLibraryEntry {
  return {
    scope: 'SYSTEM',
    libraryRevisionId: 'sys-1',
    libraryVersion: 'rev-a.4',
    libraryState: 'PUBLISHED',
    entryId: 'TON',
    kind: 'FUNCTION_BLOCK',
    name: 'TON',
    featureState: 'AVAILABLE',
    contentSha256: 'a'.repeat(64),
    signature: {
      category: 'timer',
      labelVi: 'Trễ bật',
      labelEn: 'On delay',
      dispatch: 'FB_TYPE',
      polymorphic: false,
      allowedTypes: [],
      typedPortNames: [],
      ports: [
        { name: 'IN', direction: 'INPUT', dataType: 'BOOL' },
        { name: 'PT', direction: 'INPUT', dataType: 'TIME' },
        { name: 'Q', direction: 'OUTPUT', dataType: 'BOOL' },
      ],
    },
    category: 'timer',
    dependencies: [],
    stateLayoutKnown: true,
    stateSizeBytes: 16,
    ...overrides,
  }
}

/** Đường tắt cho test chỉ cần mô hình trình bày. */
export function libraryPresentationFixture(
  overrides: Partial<ProgrammingLibraryEntry> = {},
): LibraryPresentation {
  return libraryPresentation(libraryEntryFixture(overrides))
}

import type { ProgrammingImpactKey } from '../api/generated/client'

/**
 * `T61-503` — thứ tự và nhãn của các nhóm ảnh hưởng, ở một mô-đun THUẦN DỮ LIỆU.
 *
 * Tách khỏi `CheckCommissionPage` vì hai lý do, và lý do thứ hai mới là lý do
 * lát này tồn tại:
 *
 *  1. Đây là dữ liệu, không phải giao diện: đọc nó không cần dựng cây component.
 *  2. Bộ e2e phải đối chiếu fixture `impact` với **chính danh sách mà trang
 *     dùng để vẽ**. Nhập nó từ `CheckCommissionPage` kéo theo cả cây import của
 *     một trang React — trong đó có `shared/productInfo` nhập thẳng
 *     `package.json`, thứ mà bộ nạp module của Playwright từ chối. Chép danh
 *     sách sang bộ test thì lại tạo bản sao thứ hai, và bản sao chính là thứ đã
 *     làm fixture `impact` cũ đi trong im lặng.
 */
export const IMPACT_GROUP_ORDER: ProgrammingImpactKey[] = [
  'enableIntent', 'programSet', 'retain', 'activeOverrides',
  'cutover', 'outputMappingChanges', 'writableOutputsAffected',
  'physicalMappingChanges', 'modbusMappingChanges', 'virtualPointChanges',
  'publishedSignals', 'controlLibrary'
]

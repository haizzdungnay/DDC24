/**
 * Khai báo kiểu TỐI THIỂU cho ba builtin của Node mà **chỉ test** dùng tới.
 *
 * VÌ SAO KHÔNG CÀI `@types/node`
 *
 * Dự án cố ý không có gói đó — lý do ghi ở đầu `shared/theme/tokens.ts`: mỗi
 * dependency mới trong cây build của một thiết bị nhúng phải trả giá bằng dung
 * lượng eMMC và bằng bề mặt cần rà soát an ninh. Hai test hợp đồng
 * (`drilldown.contract.test.ts`, `i18n.hmiVocabulary.test.ts`) cần đọc mã
 * nguồn của bề mặt khác — kể cả `apps/hmi` bằng C++ — nên không thể dùng `?raw`
 * của Vite (`apps/hmi` nằm ngoài root, Vite trả `Denied ID`) và cũng không nên
 * nới `server.fs.allow` chỉ để phục vụ test.
 *
 * Phạm vi ở đây hẹp đúng bằng chỗ đang dùng: đọc tệp đồng bộ và ghép đường
 * dẫn. Không mô tả cả Node API, để không ai nhầm đây là giấy phép dùng Node
 * builtin trong mã production — mã chạy trên trình duyệt thì không có chúng.
 */
declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf8'): string
}

declare module 'node:url' {
  export function fileURLToPath(url: string | URL): string
}

declare module 'node:path' {
  export function dirname(path: string): string
  export function resolve(...paths: string[]): string
}

import { canonicalFbdJson, validateFbdDocument, type FbdDocument } from './model'

export type FbdDocumentReadResult =
  | { ok: true; document: FbdDocument; canonical: string }
  | { ok: false; code: 'FBD-SCHEMA-JSON-001'; detail: string }

/**
 * Đọc buffer FBD theo fail-closed trước khi mount editor.
 *
 * Validator được gọi trước canonicalizer vì canonicalizer cố ý bỏ `layout`
 * sai để có thể tạo chuỗi phục vụ báo lỗi kích thước. Với đường chỉnh sửa,
 * hành vi đó sẽ làm lần Save kế tiếp mất nguyên layout hỏng mà người dùng chưa
 * hề xác nhận. Shape lồng hỏng cũng có thể làm validator ném lỗi; cả hai trường
 * hợp đều khóa editor và giữ nguyên byte nguồn.
 */
export function readFbdDocument(raw: unknown): FbdDocumentReadResult {
  try {
    if (typeof raw !== 'string') throw new Error('document không phải chuỗi JSON')
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as { networks?: unknown }).networks)) {
      throw new Error('root/networks không đúng cấu trúc FBD')
    }
    const document = parsed as FbdDocument
    const issues = validateFbdDocument(document)
    const schemaIssue = issues.find((issue) => issue.code.startsWith('FBD-SCHEMA-'))
    if (schemaIssue) {
      throw new Error(`${schemaIssue.code}: ${schemaIssue.path} không đúng schema FBD`)
    }
    return { ok: true, document, canonical: canonicalFbdJson(document) }
  } catch (error) {
    return {
      ok: false,
      code: 'FBD-SCHEMA-JSON-001',
      detail: error instanceof Error ? error.message : String(error),
    }
  }
}

import { createUuid } from '../../../../shared/crypto'
import { canonicalFbdJson, FBD_PROFILE_ID, FBD_SCHEMA_VERSION, type FbdDocument } from '../../fbd/model'
import type { PouKind, PouLanguage } from './pouViewModel'

/**
 * Nội dung khởi tạo cho POU mới. Một POU rỗng luôn làm Check FAILED ngay lúc
 * tạo (`F-PROG-ASBUILT-001`/D-02), nên mỗi kind phải ra đời với khung tối thiểu
 * hợp lệ theo grammar mà `parse_st_pou` chấp nhận — không phải chuỗi rỗng.
 */
export function emptyFbdDocument(name: string, kind?: PouKind): FbdDocument {
  const isFb = kind === 'FUNCTION_BLOCK'
  const outputNodeId = createUuid()
  // ponytail: FB FBD cần sẵn ít nhất một đầu ra 'q' : BOOL để kéo thả được ngay; nâng cấp thêm port cấu hình khi mở rộng wizard tạo POU.
  const networks = [
    {
      id: createUuid(),
      name: 'network_1',
      order: 0,
      nodes: isFb
        ? [
            {
              id: outputNodeId,
              kind: 'OUTPUT' as const,
              typeRef: 'BOOL',
              executionOrder: 0,
              parameters: { variable: 'q' },
              ports: [
                {
                  id: createUuid(),
                  name: 'IN',
                  direction: 'INPUT' as const,
                  dataType: 'BOOL' as const,
                  unit: null,
                  order: 0,
                },
              ],
            },
          ]
        : [],
      wires: [],
    },
  ]
  return {
    $schema: '../../fbd_v1.schema.json',
    schemaVersion: FBD_SCHEMA_VERSION,
    profileId: FBD_PROFILE_ID,
    graphId: createUuid(),
    name,
    networks,
    ...(isFb
      ? {
          layout: {
            schemaVersion: 1 as const,
            nodes: {
              [outputNodeId]: { x: 240, y: 80 },
            },
          },
        }
      : {}),
  }
}

/* FUNCTION phải có kiểu trả về và phải gán cho chính tên hàm; FUNCTION_BLOCK
 * phải có ít nhất một cổng để còn gọi được. Đây là khung nhỏ nhất mà compiler
 * nhận, không phải ví dụ dạy học. */
export function pouSourceTemplate(kind: PouKind, language: PouLanguage, name: string): string {
  if (language === 'FBD') return canonicalFbdJson(emptyFbdDocument(name, kind))
  if (kind === 'FUNCTION') {
    return `FUNCTION ${name} : REAL\nVAR_INPUT value : REAL; END_VAR\n${name} := value;\nEND_FUNCTION\n`
  }
  if (kind === 'FUNCTION_BLOCK') {
    return `FUNCTION_BLOCK ${name}\nVAR_INPUT pv : REAL; END_VAR\nVAR_OUTPUT q : BOOL; END_VAR\nq := pv > 0.0;\nEND_FUNCTION_BLOCK\n`
  }
  return `PROGRAM ${name}\nEND_PROGRAM\n`
}

/** Tên mặc định theo kind/ngôn ngữ. Tên POU là token hợp đồng chứ không phải
 *  copy được dịch — có dấu hoặc khoảng trắng là backend từ chối ngay. */
export function defaultPouName(kind: PouKind, language: PouLanguage): string {
  if (kind === 'FUNCTION') return 'NewFunction'
  if (kind === 'FUNCTION_BLOCK') return 'NewFunctionBlock'
  return language === 'FBD' ? 'NewFbdProgram' : 'NewProgram'
}

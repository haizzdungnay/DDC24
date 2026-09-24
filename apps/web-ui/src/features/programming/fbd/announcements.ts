/**
 * BUG-012 — bản cũ ghi thẳng câu tiếng Việt vào `announcement`, nên vùng
 * `aria-live` (đọc bởi screen reader) luôn tiếng Việt bất kể locale UI đang
 * chọn. Reducer là hàm thuần, không gọi được `useI18n()`, nên chỉ lưu MÃ +
 * tham số ở đây; dịch xảy ra lúc render qua `translateFbdAnnouncement`.
 */
export interface FbdAnnouncement {
  code: string
  params?: Record<string, string | number>
}

/** Dịch `announcement` sang locale hiện tại lúc render (component gọi
 *  `useI18n().pick`) — reducer ở trên chỉ lưu mã, không quyết định ngôn ngữ. */
export function translateFbdAnnouncement(pick: (vi: string, en: string) => string, announcement: FbdAnnouncement): string {
  const p = announcement.params ?? {}
  switch (announcement.code) {
    case 'idle': return ''
    case 'port-not-found': return pick('Không tìm thấy port được chọn', 'Selected port not found')
    case 'select-output-port': return pick('Hãy chọn port OUTPUT để bắt đầu nối', 'Select an OUTPUT port to start connecting')
    case 'source-selected': return pick(`Đã chọn nguồn ${p.port}`, `Selected source ${p.port}`)
    case 'connect-incompatible': return pick('Không thể nối: port phải cùng network, đúng hướng, type và unit', 'Cannot connect: ports must share network, direction, type and unit')
    case 'wire-mismatch': return pick('Payload wire không khớp hai port đã chọn', 'Wire payload does not match the two selected ports')
    case 'wire-uuid-invalid': return pick('UUID wire không canonical hoặc bị trùng', 'Wire UUID is not canonical or is duplicated')
    case 'connect-reverse-order': return pick('Không thể nối ngược thứ tự thực thi combinational', 'Cannot connect against combinational execution order')
    case 'input-has-driver-or-limit': return pick('Input đã có driver hoặc graph đã đạt giới hạn wire', 'Input already has a driver, or the graph reached the wire limit')
    case 'network-missing': return pick('Network không còn tồn tại', 'Network no longer exists')
    case 'wire-connected': return pick(`Đã nối ${p.from} tới ${p.to}`, `Connected ${p.from} to ${p.to}`)
    case 'wire-reconnected': return pick(`Đã nối lại ${p.from} tới ${p.to}`, `Reconnected ${p.from} to ${p.to}`)
    case 'wire-not-found': return pick('Dây cần nối lại không còn tồn tại', 'The wire to reconnect no longer exists')
    case 'wire-unchanged': return pick('Dây vẫn giữ nguyên hai đầu nối', 'The wire already has these endpoints')
    case 'draft-synced-external': return pick('Draft đã được đồng bộ từ nguồn ngoài', 'Draft synced from an external source')
    case 'edit-enabled': return pick('Đã bật quyền sửa', 'Edit mode enabled')
    case 'read-only-mode': return pick('Chế độ chỉ đọc', 'Read-only mode')
    case 'selection-changed': return pick('Đã đổi vùng chọn', 'Selection changed')
    case 'selection-cleared': return pick('Đã bỏ chọn', 'Selection cleared')
    case 'no-ports': return pick('Graph không có port', 'Graph has no ports')
    case 'port-selected': return pick(`Đã chọn port ${p.index}/${p.total}`, `Selected port ${p.index}/${p.total}`)
    case 'no-edit-permission': return pick('Không có quyền sửa Draft', 'No permission to edit the Draft')
    case 'network-limit-reached': return pick('Đã đạt giới hạn network', 'Reached the network limit')
    case 'network-uuid-invalid': return pick('UUID network/node/port/wire không canonical hoặc bị trùng', 'Network/node/port/wire UUID is not canonical or is duplicated')
    case 'network-added': return pick(`Đã thêm network ${p.name}`, `Added network ${p.name}`)
    case 'block-limit-reached': return pick('Đã đạt giới hạn 256 block', 'Reached the 256-block limit')
    case 'block-uuid-invalid': return pick('UUID block/port không canonical hoặc bị trùng', 'Block/port UUID is not canonical or is duplicated')
    case 'network-not-found': return pick('Không tìm thấy network', 'Network not found')
    case 'block-added': return pick(`Đã thêm block ${p.type}`, `Added block ${p.type}`)
    case 'connection-cancelled': return pick('Đã hủy thao tác nối', 'Connection cancelled')
    case 'no-selection': return pick('Chưa chọn phần tử cần xóa', 'No element selected to delete')
    case 'cannot-delete-selection': return pick('Không thể xóa phần tử đã chọn', 'Cannot delete the selected element')
    case 'no-wires-to-disconnect': return pick('Không có dây nào để ngắt', 'There is no wire to disconnect')
    case 'wires-disconnected': return pick(`Đã ngắt ${p.count} dây`, `Disconnected ${p.count} ${p.count === 1 ? 'wire' : 'wires'}`)
    case 'selection-deleted': return pick('Đã xóa phần tử và các wire liên quan', 'Deleted the element and its related wires')
    case 'select-block-to-reorder': return pick('Hãy chọn block cần đổi thứ tự', 'Select a block to reorder')
    case 'reorder-at-boundary': return pick('Block đã ở biên thứ tự', 'Block is already at the order boundary')
    case 'block-reordered': return pick('Đã đổi thứ tự thực thi block', 'Block execution order changed')
    case 'block-moved': return pick('Đã đổi vị trí block trên canvas', 'Block moved on the canvas')
    case 'block-review-required': return pick('Khối chưa qua Controls+Safety review, không thể thêm vào sơ đồ', 'Block is not Controls+Safety reviewed and cannot be added')
    case 'invalid-position': return pick('Vị trí ngoài phạm vi canvas cho phép', 'Position is outside the allowed canvas range')
    case 'node-not-found': return pick('Không tìm thấy node đã chọn', 'Selected node not found')
    case 'invalid-node-attributes': return pick('Thuộc tính không áp dụng cho loại node này', 'Attributes do not apply to this node kind')
    case 'invalid-variable-name': return pick('Tên biến không hợp lệ', 'Invalid variable name')
    case 'invalid-unit': return pick('Đơn vị không hợp lệ (1-32 ký tự)', 'Invalid unit (1-32 characters)')
    case 'node-variable-set': return pick(`Đã đặt biến ${p.variable}`, `Set variable ${p.variable}`)
    case 'invalid-constant-value': return pick('Giá trị hằng số không hợp lệ với kiểu đã chọn', 'Constant value is not valid for the selected type')
    case 'node-value-set': return pick('Đã cập nhật giá trị hằng số', 'Constant value updated')
    case 'invalid-data-type': return pick('Kiểu dữ liệu không hợp lệ cho node này', 'Data type is not valid for this node')
    case 'node-type-set': return pick(`Đã đổi kiểu sang ${p.type}`, `Type changed to ${p.type}`)
    case 'invalid-instance-name': return pick('Tên instance không hợp lệ', 'Invalid instance name')
    case 'node-fb-params-set': return pick('Đã cập nhật tham số function block', 'Function block parameters updated')
    case 'node-parameters-set': return pick('Đã cập nhật tham số chỉnh định', 'Tuning parameters updated')
    case 'invalid-parameter-name': return pick('Tên tham số không hợp lệ', 'Invalid parameter name')
    case 'invalid-parameter-value': return pick('Giá trị tham số không hợp lệ', 'Invalid parameter value')
    case 'node-attributes-updated': return pick('Đã cập nhật thuộc tính node', 'Node attributes updated')
    case 'selection-revision-mismatch': return pick('Phiên bản vùng chọn không khớp', 'Selection revision mismatch')
    case 'wire-limit-reached': return pick('Đã đạt giới hạn wire', 'Reached wire limit')
    case 'blocks-moved': return pick('Đã đổi vị trí các block trên canvas', 'Blocks moved on canvas')
    case 'subgraph-pasted': return pick('Đã dán subgraph vào canvas', 'Subgraph pasted to canvas')
    case 'nothing-to-undo': return pick('Không còn thay đổi để hoàn tác', 'No more changes to undo')
    case 'undone': return pick('Đã hoàn tác', 'Undone')
    case 'nothing-to-redo': return pick('Không còn thay đổi để làm lại', 'No more changes to redo')
    case 'redone': return pick('Đã làm lại', 'Redone')
    case 'wire-cut-to-reference': return pick('Đã chuyển dây thành tham chiếu', 'Converted wire to reference')
    case 'reference-joined-to-wire': return pick('Đã nối lại thành dây', 'Joined reference to wire')
    case 'reference-renamed': return pick('Đã đổi tên tín hiệu tham chiếu', 'Reference signal renamed')
    case 'reference-offset-updated': return pick('Đã điều chỉnh độ dài dây nối', 'Wire length adjusted')
    case 'references-batch-cut': return pick('Đã chuyển các dây thành tham chiếu', 'Converted wires to references')
    case 'references-batch-joined': return pick('Đã nối lại các dây', 'Joined references to wires')
    case 'invalid-reference-signal-name': return pick('Tên tín hiệu không hợp lệ', 'Invalid reference signal name')
    case 'wire-not-in-reference': return pick('Dây không ở chế độ tham chiếu', 'Wire is not a reference')
    case 'reference-not-found': return pick('Không tìm thấy tham chiếu', 'Reference not found')
    default: return ''
  }
}

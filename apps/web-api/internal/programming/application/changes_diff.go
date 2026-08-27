package application

import (
	"bytes"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"unicode/utf8"

	programmingstore "mkddc-web/internal/programming/store"
)

/*
`T59-819` / `PGM02-V22-WP-09` (phần còn nợ) — typed diff cho Compare Draft↔Active.

Trước lát này `GetRevisionChanges` chỉ trả danh sách object kèm hash trước/sau.
Điều đó đủ để nói "có gì đó đổi" nhưng không đủ để người vận hành TRẢ LỜI được
câu duy nhất họ hỏi trước khi Commission: *đổi cái gì*. Hash khác nhau là một sự
kiện, không phải một lời giải thích.

Ba luật của bộ diff này:

 1. **Tất định.** Cùng hai Revision ⇒ cùng một chuỗi hunk, cùng thứ tự, cùng
    nội dung. Mọi vòng lặp trên map đều được sắp trước khi phát ra.
 2. **Có biên và nói ra khi chạm biên.** Một Revision đổi mọi dòng của mười
    Program sẽ sinh payload khổng lồ. Cắt là bắt buộc; cắt IM LẶNG thì không —
    một danh sách bị cắt trông y hệt một danh sách đầy đủ.
 3. **Phân biệt "đổi thứ tự" và "đổi hình học" với "đổi logic".** Kéo một khối
    sang chỗ khác trên canvas không đổi hành vi chương trình; gộp nó chung với
    một thay đổi `typeRef` sẽ làm người đọc mất khả năng phân biệt thứ cần soi
    kỹ với thứ chỉ cần liếc.
*/

const (
	// Trần payload. Chạm trần thì `truncated=true` và `nextCursor` chỉ chỗ đọc
	// tiếp — không bao giờ cắt im lặng.
	maxDiffEntries = 200
	// Số dòng tối đa giữ lại cho MỖI phía của một hunk.
	maxHunkLines = 40
	// Mỗi dòng cũng có biên riêng. Chỉ chặn số dòng là chưa đủ: một dòng ST
	// bệnh lý dài hàng MiB vẫn có thể phá trần payload dù hunk chỉ có một dòng.
	maxHunkLineRunes = 4096
	// Trần kích thước đầu vào cho thuật toán LCS. Vượt trần thì hạ xuống một
	// hunk `REPLACED` cho cả file và ghi `coarse=true`: thà nói "cả file đổi"
	// một cách trung thực còn hơn treo máy chủ vì một tài liệu bệnh lý.
	maxDiffLines = 4000
)

// Bộ giá trị enum mà bộ diff có thể phát ra.
//
// Chúng là HẰNG chứ không phải chuỗi rải rác vì cổng đồng bộ hợp đồng ở lớp
// transport đọc thẳng ba slice dưới đây thay vì chép lại danh sách. Phía TS có
// generator sinh type từ OpenAPI; phía Go thì không, nên nếu contract test tự
// giữ một bản sao chuỗi, OpenAPI có thể lệch khỏi thứ máy chủ thật sự gửi mà
// không đèn nào đỏ.
const (
	DiffChangeAdded        = "ADDED"
	DiffChangeRemoved      = "REMOVED"
	DiffChangeReplaced     = "REPLACED"
	DiffChangeUpdated      = "UPDATED"
	DiffChangeOrderOnly    = "ORDER_ONLY"
	DiffChangeGeometryOnly = "GEOMETRY_ONLY"

	FbdElementNetwork = "NETWORK"
	FbdElementNode    = "NODE"
	FbdElementPort    = "PORT"
	FbdElementWire    = "WIRE"
)

// StHunkChangeTypes — `changeType` hợp lệ của một hunk ST. Không có
// `ORDER_ONLY`/`GEOMETRY_ONLY`: hai khái niệm đó chỉ tồn tại trên đồ thị FBD.
var StHunkChangeTypes = []string{DiffChangeAdded, DiffChangeRemoved, DiffChangeReplaced}

// FbdChangeTypes — `changeType` hợp lệ của một thay đổi FBD.
var FbdChangeTypes = []string{
	DiffChangeAdded, DiffChangeRemoved, DiffChangeUpdated,
	DiffChangeOrderOnly, DiffChangeGeometryOnly,
}

// FbdElements — loại phần tử đồ thị mà một thay đổi FBD có thể trỏ tới.
var FbdElements = []string{FbdElementNetwork, FbdElementNode, FbdElementPort, FbdElementWire}

// StHunk là một đoạn thay đổi liên tục của mã nguồn ST.
type StHunk struct {
	ObjectID string `json:"objectId"`
	// ADDED | REMOVED | REPLACED
	ChangeType      string   `json:"changeType"`
	BeforeStartLine int      `json:"beforeStartLine"`
	BeforeLineCount int      `json:"beforeLineCount"`
	AfterStartLine  int      `json:"afterStartLine"`
	AfterLineCount  int      `json:"afterLineCount"`
	BeforeText      []string `json:"beforeText"`
	AfterText       []string `json:"afterText"`
	// `true` khi thân hunk bị cắt bớt so với thực tế.
	Truncated bool `json:"truncated"`
	// `true` khi tài liệu vượt trần LCS và cả file bị hạ thành một hunk.
	Coarse bool `json:"coarse"`
}

// FbdChange là một thay đổi trên đồ thị canonical.
type FbdChange struct {
	ObjectID string `json:"objectId"`
	// NETWORK | NODE | PORT | WIRE
	Element   string `json:"element"`
	ElementID string `json:"elementId"`
	// ADDED | REMOVED | UPDATED | ORDER_ONLY | GEOMETRY_ONLY
	ChangeType string `json:"changeType"`
	// Khoá ổn định của thứ đã đổi (`typeRef`, `dataType`, `executionOrder`…).
	// Rỗng với ADDED/REMOVED.
	Detail string `json:"detail"`
}

type fbdPortShape struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Direction string `json:"direction"`
	DataType  string `json:"dataType"`
	Unit      any    `json:"unit"`
	Order     int    `json:"order"`
}

type fbdNodeShape struct {
	ID             string         `json:"id"`
	Kind           string         `json:"kind"`
	TypeRef        string         `json:"typeRef"`
	ExecutionOrder int            `json:"executionOrder"`
	Parameters     map[string]any `json:"parameters"`
	Ports          []fbdPortShape `json:"ports"`
}

type fbdWireShape struct {
	ID   string `json:"id"`
	From struct {
		NodeID string `json:"nodeId"`
		PortID string `json:"portId"`
	} `json:"from"`
	To struct {
		NodeID string `json:"nodeId"`
		PortID string `json:"portId"`
	} `json:"to"`
}

type fbdNetworkShape struct {
	ID    string         `json:"id"`
	Name  string         `json:"name"`
	Order int            `json:"order"`
	Nodes []fbdNodeShape `json:"nodes"`
	Wires []fbdWireShape `json:"wires"`
}

type fbdDocumentShape struct {
	Networks []fbdNetworkShape `json:"networks"`
	Layout   map[string]any    `json:"layout"`
}

type programPayload struct {
	Language string `json:"language"`
	Source   string `json:"source"`
}

func decodeProgramPayload(object *programmingstore.RevisionObject) (programPayload, bool) {
	if object == nil {
		return programPayload{}, false
	}
	var payload programPayload
	if json.Unmarshal(object.PayloadJSON, &payload) != nil {
		return programPayload{}, false
	}
	return payload, true
}

// diffRevisionSources dựng `stHunks[]` và `fbdChanges[]` cho một cặp Revision.
//
// Trả về danh sách ĐÃ SẮP và cờ `truncated` khi chạm trần. Người gọi truyền
// `cursor` để đọc tiếp — cursor là chỉ số vào chính danh sách tất định này, nên
// hai lần gọi liên tiếp không thể bỏ sót hay lặp mục.
func diffRevisionSources(
	before, after []programmingstore.RevisionObject, cursor int,
) (hunks []StHunk, fbdChanges []FbdChange, nextCursor int, truncated bool, err error) {
	beforeByID := indexObjects(before)
	afterByID := indexObjects(after)

	objectIDs := make([]string, 0, len(beforeByID)+len(afterByID))
	seen := make(map[string]struct{}, len(beforeByID)+len(afterByID))
	for id := range beforeByID {
		if _, found := seen[id]; !found {
			seen[id] = struct{}{}
			objectIDs = append(objectIDs, id)
		}
	}
	for id := range afterByID {
		if _, found := seen[id]; !found {
			seen[id] = struct{}{}
			objectIDs = append(objectIDs, id)
		}
	}
	// Sắp theo `objectId` để thứ tự phát ra không phụ thuộc thứ tự duyệt map.
	sort.Strings(objectIDs)

	allHunks := make([]StHunk, 0)
	allFbd := make([]FbdChange, 0)
	for _, objectID := range objectIDs {
		beforeObject, beforeExists := beforeByID[objectID]
		afterObject, afterExists := afterByID[objectID]
		if beforeExists && afterExists && bytes.Equal(beforeObject.PayloadJSON, afterObject.PayloadJSON) {
			continue
		}
		beforePayload, beforeOK := decodeProgramPayload(beforeObject)
		afterPayload, afterOK := decodeProgramPayload(afterObject)
		if (beforeExists && !beforeOK) || (afterExists && !afterOK) {
			return nil, nil, 0, false, fmt.Errorf("typed revision diff: payload PROGRAM %s không đọc được", objectID)
		}
		language := afterPayload.Language
		if !afterExists {
			language = beforePayload.Language
		}
		if beforeExists && afterExists && !strings.EqualFold(beforePayload.Language, afterPayload.Language) {
			return nil, nil, 0, false, fmt.Errorf("typed revision diff: ngôn ngữ PROGRAM %s đổi từ %s sang %s", objectID, beforePayload.Language, afterPayload.Language)
		}
		switch strings.ToUpper(language) {
		case "ST":
			allHunks = append(allHunks, diffStSource(objectID, beforePayload.Source, afterPayload.Source)...)
		case "FBD":
			// Tài liệu FBD có mặt nhưng không parse được là UNKNOWN, tuyệt đối
			// không được biến thành mảng rỗng rồi hiện "không có khác biệt".
			if (beforeExists && !validFbdSource(beforePayload.Source)) || (afterExists && !validFbdSource(afterPayload.Source)) {
				return nil, nil, 0, false, fmt.Errorf("typed revision diff: tài liệu FBD %s không đọc được", objectID)
			}
			allFbd = append(allFbd, diffFbdSource(objectID, beforePayload.Source, afterPayload.Source)...)
		default:
			return nil, nil, 0, false, fmt.Errorf("typed revision diff: ngôn ngữ PROGRAM %s không được hỗ trợ: %q", objectID, language)
		}
	}

	total := len(allHunks) + len(allFbd)
	if cursor < 0 || cursor > total {
		return nil, nil, 0, false, ErrInvalidCursor
	}
	// Một danh sách phẳng theo thứ tự: ST trước, FBD sau. Cursor đi trên danh
	// sách phẳng đó nên client không phải biết cấu trúc bên trong.
	end := cursor + maxDiffEntries
	if end >= total {
		end = total
		nextCursor = 0
	} else {
		truncated = true
		nextCursor = end
	}
	for index := cursor; index < end; index++ {
		if index < len(allHunks) {
			hunks = append(hunks, allHunks[index])
			continue
		}
		fbdChanges = append(fbdChanges, allFbd[index-len(allHunks)])
	}
	if hunks == nil {
		hunks = make([]StHunk, 0)
	}
	if fbdChanges == nil {
		fbdChanges = make([]FbdChange, 0)
	}
	return hunks, fbdChanges, nextCursor, truncated, nil
}

func indexObjects(objects []programmingstore.RevisionObject) map[string]*programmingstore.RevisionObject {
	index := make(map[string]*programmingstore.RevisionObject, len(objects))
	for position := range objects {
		object := &objects[position]
		if object.Kind != "PROGRAM" {
			continue
		}
		index[object.ObjectID] = object
	}
	return index
}

func splitLines(source string) []string {
	if source == "" {
		return nil
	}
	normalized := strings.ReplaceAll(source, "\r\n", "\n")
	lines := strings.Split(normalized, "\n")
	// Một tài liệu kết thúc bằng newline không có "dòng rỗng cuối" — giữ nó lại
	// sẽ tạo một hunk giả mỗi lần ai đó thêm/bớt newline cuối file.
	if len(lines) > 0 && lines[len(lines)-1] == "" {
		lines = lines[:len(lines)-1]
	}
	return lines
}

// diffStSource sinh hunk theo dòng.
//
// Thuật toán: LCS trên dòng. Không dùng "cắt tiền tố/hậu tố chung rồi coi phần
// giữa là một REPLACED": cách đó biến một lần chèn ở giữa file thành một hunk
// bao trùm gần hết file, và người đọc mất đúng thông tin họ cần.
func diffStSource(objectID, before, after string) []StHunk {
	beforeLines := splitLines(before)
	afterLines := splitLines(after)
	if len(beforeLines) == 0 && len(afterLines) == 0 {
		return nil
	}
	if equalLines(beforeLines, afterLines) {
		return nil
	}

	if len(beforeLines) > maxDiffLines || len(afterLines) > maxDiffLines {
		// Vượt trần LCS: nói "cả file đổi" một cách trung thực, kèm cờ `coarse`
		// để người đọc biết đây là kết luận thô chứ không phải diff chi tiết.
		return []StHunk{trimHunk(StHunk{
			ObjectID: objectID, ChangeType: DiffChangeReplaced,
			BeforeStartLine: 1, BeforeLineCount: len(beforeLines),
			AfterStartLine: 1, AfterLineCount: len(afterLines),
			BeforeText: beforeLines, AfterText: afterLines, Coarse: true,
		})}
	}

	lcs := longestCommonSubsequence(beforeLines, afterLines)
	hunks := make([]StHunk, 0)
	beforeIndex, afterIndex := 0, 0
	for _, match := range append(lcs, [2]int{len(beforeLines), len(afterLines)}) {
		beforeEnd, afterEnd := match[0], match[1]
		if beforeEnd > beforeIndex || afterEnd > afterIndex {
			hunk := StHunk{
				ObjectID:        objectID,
				BeforeStartLine: beforeIndex + 1,
				BeforeLineCount: beforeEnd - beforeIndex,
				AfterStartLine:  afterIndex + 1,
				AfterLineCount:  afterEnd - afterIndex,
				BeforeText:      append([]string(nil), beforeLines[beforeIndex:beforeEnd]...),
				AfterText:       append([]string(nil), afterLines[afterIndex:afterEnd]...),
			}
			switch {
			case hunk.BeforeLineCount == 0:
				hunk.ChangeType = DiffChangeAdded
			case hunk.AfterLineCount == 0:
				hunk.ChangeType = DiffChangeRemoved
			default:
				hunk.ChangeType = DiffChangeReplaced
			}
			hunks = append(hunks, trimHunk(hunk))
		}
		beforeIndex, afterIndex = beforeEnd+1, afterEnd+1
		if beforeIndex > len(beforeLines) {
			beforeIndex = len(beforeLines)
		}
		if afterIndex > len(afterLines) {
			afterIndex = len(afterLines)
		}
	}
	return hunks
}

func trimHunk(hunk StHunk) StHunk {
	if len(hunk.BeforeText) > maxHunkLines {
		hunk.BeforeText = append([]string(nil), hunk.BeforeText[:maxHunkLines]...)
		hunk.Truncated = true
	}
	if len(hunk.AfterText) > maxHunkLines {
		hunk.AfterText = append([]string(nil), hunk.AfterText[:maxHunkLines]...)
		hunk.Truncated = true
	}
	if hunk.BeforeText == nil {
		hunk.BeforeText = make([]string, 0)
	}
	if hunk.AfterText == nil {
		hunk.AfterText = make([]string, 0)
	}
	for index, line := range hunk.BeforeText {
		trimmed, wasTrimmed := trimHunkLine(line)
		hunk.BeforeText[index] = trimmed
		hunk.Truncated = hunk.Truncated || wasTrimmed
	}
	for index, line := range hunk.AfterText {
		trimmed, wasTrimmed := trimHunkLine(line)
		hunk.AfterText[index] = trimmed
		hunk.Truncated = hunk.Truncated || wasTrimmed
	}
	return hunk
}

func trimHunkLine(line string) (string, bool) {
	if utf8.RuneCountInString(line) <= maxHunkLineRunes {
		return line, false
	}
	runes := []rune(line)
	return string(runes[:maxHunkLineRunes]), true
}

func equalLines(left, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}

// longestCommonSubsequence trả các cặp chỉ số (before, after) khớp nhau, tăng dần.
func longestCommonSubsequence(before, after []string) [][2]int {
	rows, columns := len(before), len(after)
	// maxDiffLines < uint16 max. Dùng uint16 giữ trần ma trận 4001² ở khoảng
	// 32 MiB thay vì >128 MiB với int trên hệ 64-bit.
	table := make([][]uint16, rows+1)
	for index := range table {
		table[index] = make([]uint16, columns+1)
	}
	for i := rows - 1; i >= 0; i-- {
		for j := columns - 1; j >= 0; j-- {
			if before[i] == after[j] {
				table[i][j] = table[i+1][j+1] + 1
				continue
			}
			if table[i+1][j] >= table[i][j+1] {
				table[i][j] = table[i+1][j]
			} else {
				table[i][j] = table[i][j+1]
			}
		}
	}
	matches := make([][2]int, 0)
	i, j := 0, 0
	for i < rows && j < columns {
		if before[i] == after[j] {
			matches = append(matches, [2]int{i, j})
			i++
			j++
			continue
		}
		if table[i+1][j] >= table[i][j+1] {
			i++
		} else {
			j++
		}
	}
	return matches
}

// diffFbdSource so hai đồ thị canonical theo ID.
func diffFbdSource(objectID, before, after string) []FbdChange {
	beforeDoc, beforeOK := decodeFbd(before)
	afterDoc, afterOK := decodeFbd(after)
	if !beforeOK && !afterOK {
		return nil
	}

	changes := make([]FbdChange, 0)
	beforeNetworks := indexNetworks(beforeDoc.Networks)
	afterNetworks := indexNetworks(afterDoc.Networks)
	for _, networkID := range sortedNetworkKeys(beforeNetworks, afterNetworks) {
		beforeNetwork, inBefore := beforeNetworks[networkID]
		afterNetwork, inAfter := afterNetworks[networkID]
		switch {
		case !inBefore:
			changes = append(changes, FbdChange{objectID, FbdElementNetwork, networkID, DiffChangeAdded, ""})
		case !inAfter:
			changes = append(changes, FbdChange{objectID, FbdElementNetwork, networkID, DiffChangeRemoved, ""})
		default:
			if beforeNetwork.Name != afterNetwork.Name {
				changes = append(changes, FbdChange{objectID, FbdElementNetwork, networkID, DiffChangeUpdated, "name"})
			}
			if beforeNetwork.Order != afterNetwork.Order {
				changes = append(changes, FbdChange{objectID, FbdElementNetwork, networkID, DiffChangeOrderOnly, "order"})
			}
		}
	}

	beforeNodes, beforeWires, beforeNodeNetworks, beforeWireNetworks := flattenFbd(beforeDoc)
	afterNodes, afterWires, afterNodeNetworks, afterWireNetworks := flattenFbd(afterDoc)

	for _, nodeID := range sortedKeys(beforeNodes, afterNodes) {
		beforeNode, inBefore := beforeNodes[nodeID]
		afterNode, inAfter := afterNodes[nodeID]
		switch {
		case !inBefore:
			changes = append(changes, FbdChange{objectID, FbdElementNode, nodeID, DiffChangeAdded, ""})
		case !inAfter:
			changes = append(changes, FbdChange{objectID, FbdElementNode, nodeID, DiffChangeRemoved, ""})
		default:
			changes = append(changes, diffFbdNode(objectID, beforeNode, afterNode)...)
			if beforeNodeNetworks[nodeID] != afterNodeNetworks[nodeID] {
				changes = append(changes, FbdChange{objectID, FbdElementNode, nodeID, DiffChangeUpdated, "networkId"})
			}
		}
	}

	for _, wireID := range sortedWireKeys(beforeWires, afterWires) {
		beforeWire, inBefore := beforeWires[wireID]
		afterWire, inAfter := afterWires[wireID]
		switch {
		case !inBefore:
			changes = append(changes, FbdChange{objectID, FbdElementWire, wireID, DiffChangeAdded, ""})
		case !inAfter:
			changes = append(changes, FbdChange{objectID, FbdElementWire, wireID, DiffChangeRemoved, ""})
		case beforeWire.From != afterWire.From || beforeWire.To != afterWire.To:
			changes = append(changes, FbdChange{objectID, FbdElementWire, wireID, DiffChangeUpdated, "endpoint"})
		default:
			if beforeWireNetworks[wireID] != afterWireNetworks[wireID] {
				changes = append(changes, FbdChange{objectID, FbdElementWire, wireID, DiffChangeUpdated, "networkId"})
			}
		}
	}

	/* Hình học nằm ngoài `networks`: đổi nó KHÔNG đổi hành vi chương trình. Gộp
	 * nó chung với thay đổi logic sẽ làm người đọc mất khả năng phân biệt thứ
	 * cần soi kỹ với thứ chỉ cần liếc. */
	if beforeOK && afterOK && !equalJSON(beforeDoc.Layout, afterDoc.Layout) {
		changes = append(changes, FbdChange{objectID, FbdElementNode, "", DiffChangeGeometryOnly, "layout"})
	}
	return changes
}

func diffFbdNode(objectID string, before, after fbdNodeShape) []FbdChange {
	changes := make([]FbdChange, 0)
	if before.TypeRef != after.TypeRef {
		changes = append(changes, FbdChange{objectID, FbdElementNode, after.ID, DiffChangeUpdated, "typeRef"})
	}
	if before.Kind != after.Kind {
		changes = append(changes, FbdChange{objectID, FbdElementNode, after.ID, DiffChangeUpdated, "kind"})
	}
	if !equalJSON(before.Parameters, after.Parameters) {
		changes = append(changes, FbdChange{objectID, FbdElementNode, after.ID, DiffChangeUpdated, "parameters"})
	}
	if before.ExecutionOrder != after.ExecutionOrder {
		// Đổi thứ tự thực thi CÓ đổi hành vi, nhưng nó là một loại thay đổi
		// riêng và phải đọc được như vậy.
		changes = append(changes, FbdChange{objectID, FbdElementNode, after.ID, DiffChangeOrderOnly, "executionOrder"})
	}

	beforePorts := indexPorts(before.Ports)
	afterPorts := indexPorts(after.Ports)
	for _, portID := range sortedPortKeys(beforePorts, afterPorts) {
		beforePort, inBefore := beforePorts[portID]
		afterPort, inAfter := afterPorts[portID]
		switch {
		case !inBefore:
			changes = append(changes, FbdChange{objectID, FbdElementPort, portID, DiffChangeAdded, ""})
		case !inAfter:
			changes = append(changes, FbdChange{objectID, FbdElementPort, portID, DiffChangeRemoved, ""})
		default:
			if beforePort.DataType != afterPort.DataType {
				changes = append(changes, FbdChange{objectID, FbdElementPort, portID, DiffChangeUpdated, "dataType"})
			}
			if beforePort.Name != afterPort.Name {
				changes = append(changes, FbdChange{objectID, FbdElementPort, portID, DiffChangeUpdated, "name"})
			}
			if beforePort.Direction != afterPort.Direction {
				changes = append(changes, FbdChange{objectID, FbdElementPort, portID, DiffChangeUpdated, "direction"})
			}
			if !equalJSON(beforePort.Unit, afterPort.Unit) {
				changes = append(changes, FbdChange{objectID, FbdElementPort, portID, DiffChangeUpdated, "unit"})
			}
			if beforePort.Order != afterPort.Order {
				changes = append(changes, FbdChange{objectID, FbdElementPort, portID, DiffChangeOrderOnly, "order"})
			}
		}
	}
	return changes
}

func decodeFbd(source string) (fbdDocumentShape, bool) {
	if strings.TrimSpace(source) == "" {
		return fbdDocumentShape{}, false
	}
	var document fbdDocumentShape
	if json.Unmarshal([]byte(source), &document) != nil {
		return fbdDocumentShape{}, false
	}
	return document, true
}

func validFbdSource(source string) bool {
	_, ok := decodeFbd(source)
	return ok
}

func indexNetworks(networks []fbdNetworkShape) map[string]fbdNetworkShape {
	index := make(map[string]fbdNetworkShape, len(networks))
	for _, network := range networks {
		index[network.ID] = network
	}
	return index
}

func flattenFbd(document fbdDocumentShape) (
	map[string]fbdNodeShape, map[string]fbdWireShape, map[string]string, map[string]string,
) {
	nodes := make(map[string]fbdNodeShape)
	wires := make(map[string]fbdWireShape)
	nodeNetworks := make(map[string]string)
	wireNetworks := make(map[string]string)
	for _, network := range document.Networks {
		for _, node := range network.Nodes {
			nodes[node.ID] = node
			nodeNetworks[node.ID] = network.ID
		}
		for _, wire := range network.Wires {
			wires[wire.ID] = wire
			wireNetworks[wire.ID] = network.ID
		}
	}
	return nodes, wires, nodeNetworks, wireNetworks
}

func sortedNetworkKeys(left, right map[string]fbdNetworkShape) []string {
	seen := make(map[string]struct{}, len(left)+len(right))
	for key := range left {
		seen[key] = struct{}{}
	}
	for key := range right {
		seen[key] = struct{}{}
	}
	keys := make([]string, 0, len(seen))
	for key := range seen {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func indexPorts(ports []fbdPortShape) map[string]fbdPortShape {
	index := make(map[string]fbdPortShape, len(ports))
	for _, port := range ports {
		index[port.ID] = port
	}
	return index
}

func sortedKeys(left, right map[string]fbdNodeShape) []string {
	keys := make([]string, 0, len(left)+len(right))
	seen := make(map[string]struct{}, len(left)+len(right))
	for key := range left {
		seen[key] = struct{}{}
	}
	for key := range right {
		seen[key] = struct{}{}
	}
	for key := range seen {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func sortedWireKeys(left, right map[string]fbdWireShape) []string {
	seen := make(map[string]struct{}, len(left)+len(right))
	for key := range left {
		seen[key] = struct{}{}
	}
	for key := range right {
		seen[key] = struct{}{}
	}
	keys := make([]string, 0, len(seen))
	for key := range seen {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func sortedPortKeys(left, right map[string]fbdPortShape) []string {
	seen := make(map[string]struct{}, len(left)+len(right))
	for key := range left {
		seen[key] = struct{}{}
	}
	for key := range right {
		seen[key] = struct{}{}
	}
	keys := make([]string, 0, len(seen))
	for key := range seen {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func equalJSON(left, right any) bool {
	leftBytes, leftErr := json.Marshal(left)
	rightBytes, rightErr := json.Marshal(right)
	if leftErr != nil || rightErr != nil {
		return false
	}
	return string(leftBytes) == string(rightBytes)
}

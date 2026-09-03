package app

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
)

/* `ISS-PIO-35`: hợp đồng quality nằm ở `contracts/quality/point_quality_v1.json`
 * và cả ba tầng phải nói cùng một thứ tiếng. Test này giữ tầng Go khớp hợp đồng;
 * `apps/web-ui/src/shared/api/quality.test.ts` giữ tầng FE. */

type qualityContract struct {
	Version int `json:"version"`
	Values  []struct {
		ID   string `json:"id"`
		Wire string `json:"wire"`
	} `json:"values"`
	UnrecognizedFallback string `json:"unrecognizedFallback"`
	ForbiddenFallback    string `json:"forbiddenFallback"`
}

func loadQualityContract(t *testing.T) qualityContract {
	t.Helper()
	raw, err := os.ReadFile("../../../../contracts/quality/point_quality_v1.json")
	if err != nil {
		t.Fatalf("không đọc được hợp đồng quality: %v", err)
	}
	var doc qualityContract
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatalf("hợp đồng quality hỏng: %v", err)
	}
	return doc
}

// Mọi chuỗi mà `mapExtQuality` phát ra phải nằm trong hợp đồng. Phát một mức mà
// FE không biết sẽ khiến FE hạ nó về fallback — và trước `ISS-PIO-35`, fallback
// đó là `good`.
func TestMapExtQualityStaysInsideTheContract(t *testing.T) {
	doc := loadQualityContract(t)
	allowed := map[string]bool{}
	for _, value := range doc.Values {
		allowed[value.Wire] = true
	}
	for raw := 0; raw < 256; raw++ {
		got := mapExtQuality(uint8(raw))
		if !allowed[got] {
			t.Fatalf("mapExtQuality(%d) = %q, không có trong hợp đồng %v", raw, got, doc.Values)
		}
	}
}

// Mã lạ = producer mới hơn consumer. Nó PHẢI ra fallback của hợp đồng, và
// fallback đó không bao giờ được là `GOOD`.
func TestUnknownExtQualityCodeFallsToContractFallback(t *testing.T) {
	doc := loadQualityContract(t)
	want := strings.ToUpper(doc.UnrecognizedFallback)
	if got := mapExtQuality(200); got != want {
		t.Fatalf("mapExtQuality(200) = %q; hợp đồng nói phải là %q", got, want)
	}
	if strings.EqualFold(want, doc.ForbiddenFallback) {
		t.Fatalf("fallback của hợp đồng trùng giá trị bị cấm (%q)", doc.ForbiddenFallback)
	}
}

// Chiều còn lại: mọi mức trong hợp đồng phải có một mã `ext` sinh ra nó, TRỪ
// những mức chỉ tầng trên mới tạo. Danh sách miễn trừ được ghi tên ở đây để nó
// không âm thầm dài thêm — mỗi dòng miễn trừ là một mức mà `ext` không bao giờ
// phát, và điều đó phải là một quyết định chứ không phải một khoảng lặng.
func TestEveryContractValueIsReachableOrExplicitlyExempt(t *testing.T) {
	doc := loadQualityContract(t)
	produced := map[string]bool{}
	for raw := 0; raw < 256; raw++ {
		produced[mapExtQuality(uint8(raw))] = true
	}
	exempt := map[string]string{
		// `points.go` đặt mức này cho VP trỏ tới một slot Core chưa publish; nó
		// không đi qua bảng chất lượng của `ext`.
		"UNCERTAIN": "chỉ tầng point/VP sinh, không có mã ext tương ứng",
	}
	for _, value := range doc.Values {
		if produced[value.Wire] {
			continue
		}
		if _, ok := exempt[value.Wire]; !ok {
			t.Fatalf("hợp đồng có %q nhưng không mã ext nào sinh ra nó, và nó cũng không được ghi miễn trừ", value.Wire)
		}
	}
}

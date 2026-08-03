package health

import "testing"

func TestEvaluatePartialFailure(t *testing.T) {
	response := Evaluate(Input{CoreProcessOK: true, IobusProcessOK: false, CoreAvailable: true, IobusPresent: false, IOPStatus: "safe", Version: "v1"})
	if response.Status != "degraded" || response.Checks["core"].Status != "ok" || response.Checks["iobus"].Status != "fault" || response.Checks["mcu_connection"].Status != "degraded" {
		t.Fatalf("response = %+v", response)
	}
}

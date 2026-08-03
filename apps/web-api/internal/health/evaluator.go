package health

type Check struct {
	Status string `json:"status"`
	Detail string `json:"detail,omitempty"`
}

type Response struct {
	Status  string           `json:"status"`
	Checks  map[string]Check `json:"checks"`
	Version string           `json:"version"`
}

type Input struct {
	CoreProcessOK  bool
	IobusProcessOK bool
	CoreAvailable  bool
	IobusPresent   bool
	IOPStatus      string
	Version        string
}

func Evaluate(input Input) Response {
	checks := map[string]Check{
		"web":            {Status: "ok"},
		"core":           {Status: "fault", Detail: "process hoặc core socket không sẵn sàng"},
		"iobus":          {Status: "fault", Detail: "process iobus không sẵn sàng"},
		"io_shm":         {Status: "fault"},
		"plc_shm":        {Status: "fault"},
		"mcu_connection": {Status: "fault", Detail: "IOP không ở NORMAL"},
	}
	if input.CoreProcessOK {
		checks["core"] = Check{Status: "ok"}
	}
	if input.IobusProcessOK {
		checks["iobus"] = Check{Status: "ok"}
	}
	if input.IobusPresent {
		checks["io_shm"] = Check{Status: "ok"}
	}
	if input.CoreAvailable {
		checks["plc_shm"] = Check{Status: "ok"}
	}
	if input.IOPStatus == "normal" {
		checks["mcu_connection"] = Check{Status: "ok"}
	} else if input.IOPStatus == "safe" {
		checks["mcu_connection"] = Check{Status: "degraded", Detail: "MCU đang ở safe-state"}
	}
	status := "ok"
	for _, check := range checks {
		if check.Status != "ok" {
			status = "degraded"
			break
		}
	}
	return Response{Status: status, Checks: checks, Version: input.Version}
}

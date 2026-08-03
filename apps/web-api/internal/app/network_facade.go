package app

import (
	"context"

	webNetwork "mkddc-web/internal/network"
)

var errNetcfgUnavailable = webNetwork.ErrUnavailable
var errNetcfgInvalidResponse = webNetwork.ErrInvalidResponse

type NetcfgDNS = webNetwork.NetcfgDNS
type NetcfgCandidate = webNetwork.NetcfgCandidate
type NetcfgActive = webNetwork.NetcfgActive
type NetcfgManagement = webNetwork.NetcfgManagement
type NetcfgResponse = webNetwork.NetcfgResponse
type NetcfgClient = webNetwork.NetcfgClient

type netcfgAuthority interface {
	Request(context.Context, string, string, string, *NetcfgCandidate) (NetcfgResponse, error)
}

func NewNetcfgClient(socketPath string) *NetcfgClient {
	return webNetwork.NewNetcfgClient(socketPath)
}

func hasExactNetcfgCapabilities(capabilities []string) bool {
	return webNetwork.HasExactCapabilities(capabilities)
}

func isCanonicalNetcfgIPv4(value string) bool {
	return webNetwork.IsCanonicalIPv4(value)
}

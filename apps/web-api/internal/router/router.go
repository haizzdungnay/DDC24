package router

import (
	"fmt"
	"net/http"

	"mkddc-web/internal/auth"
)

type Authorizer interface {
	Require(auth.Role, http.HandlerFunc) http.Handler
}

type Route struct {
	Pattern string
	Role    auth.Role
	Handler http.Handler
}

func Public(pattern string, handler http.Handler) Route {
	return Route{Pattern: pattern, Handler: handler}
}

func PublicFunc(pattern string, handler http.HandlerFunc) Route {
	return Public(pattern, handler)
}

func Protected(pattern string, role auth.Role, handler http.HandlerFunc) Route {
	return Route{Pattern: pattern, Role: role, Handler: handler}
}

func New(authorizer Authorizer, routes []Route, fallback http.Handler) (*http.ServeMux, error) {
	mux := http.NewServeMux()
	seen := make(map[string]struct{}, len(routes))
	for _, route := range routes {
		if route.Pattern == "" || route.Handler == nil {
			return nil, fmt.Errorf("invalid route declaration")
		}
		if _, duplicate := seen[route.Pattern]; duplicate {
			return nil, fmt.Errorf("duplicate route %s", route.Pattern)
		}
		seen[route.Pattern] = struct{}{}
		handler := route.Handler
		if route.Role != "" {
			if authorizer == nil {
				return nil, fmt.Errorf("authorizer is required for %s", route.Pattern)
			}
			function, ok := route.Handler.(http.HandlerFunc)
			if !ok {
				return nil, fmt.Errorf("protected route %s must use HandlerFunc", route.Pattern)
			}
			handler = authorizer.Require(route.Role, function)
		}
		mux.Handle(route.Pattern, handler)
	}
	if fallback != nil {
		mux.Handle("/", fallback)
	}
	return mux, nil
}

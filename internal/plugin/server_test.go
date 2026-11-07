package plugin

import (
	"context"
	"encoding/json"
	pluginv1 "github.com/Silo-Server/silo-plugin-sdk/pkg/pluginproto/silo/plugin/v1"
	"github.com/theramindex/silo-plugin-romm/internal/romm"
	"google.golang.org/protobuf/types/known/structpb"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestHTTPAccountIdentityAndAuthenticatedContent(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/users/me" {
			w.WriteHeader(404)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":91,"username":"Player"}`))
	}))
	defer upstream.Close()
	e, err := romm.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	e.Configure(upstream.URL)
	s := &Server{Engine: e}
	defer s.Close()
	ctx := context.Background()
	headers := map[string]string{"X-Silo-User-Id": "7", "X-Silo-Profile-Id": "13"}
	call := func(path, method string, body []byte, h map[string]string) *pluginv1.HandleHTTPResponse {
		t.Helper()
		out, err := s.Handle(ctx, &pluginv1.HandleHTTPRequest{Path: path, Method: method, Body: body, Headers: h})
		if err != nil {
			t.Fatal(err)
		}
		return out
	}
	if got := call("/romm/api/connection", "GET", nil, nil); got.GetStatusCode() != 401 {
		t.Fatal("anonymous profile accepted")
	}
	if got := call("/romm/api/link", "POST", []byte(`{"token":"profile-test-token","userId":1}`), headers); got.GetStatusCode() != 200 || strings.Contains(string(got.GetBody()), "profile-test-token") {
		t.Fatalf("link response: %s", got.GetBody())
	}
	other := map[string]string{"X-Silo-User-Id": "7", "X-Silo-Profile-Id": "14"}
	var connection romm.Connection
	got := call("/romm/api/connection", "GET", nil, other)
	json.Unmarshal(got.GetBody(), &connection)
	if connection.Linked {
		t.Fatal("HTTP profile inherited another connection")
	}
	q, _ := structpb.NewStruct(map[string]any{"session": "someone-elses-ticket", "kind": "rom"})
	out, _ := s.Handle(ctx, &pluginv1.HandleHTTPRequest{Path: "/romm/api/content", Method: "GET", Query: q, Headers: headers})
	if out.GetStatusCode() != 409 || out.GetHeaders()["X-Silo-Relay-URL"] != "" {
		t.Fatal("unowned content reached relay")
	}
	for _, p := range []string{"/romm", "/romm/play"} {
		page := call(p, "GET", nil, headers)
		if page.GetStatusCode() != 200 || !strings.Contains(string(page.GetBody()), "http-equiv=\"Content-Security-Policy\"") {
			t.Fatalf("page security policy missing on %s", p)
		}
		hasEval := strings.Contains(page.GetHeaders()["Content-Security-Policy"], "'unsafe-eval'")
		if hasEval != (p == "/romm/play") {
			t.Fatal("dynamic evaluation must be scoped to the pinned emulator page")
		}
	}
}

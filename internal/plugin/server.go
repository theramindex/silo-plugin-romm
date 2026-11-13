package plugin

import (
	"context"
	"embed"
	"encoding/json"
	"errors"
	pluginv1 "github.com/Silo-Server/silo-plugin-sdk/pkg/pluginproto/silo/plugin/v1"
	"github.com/theramindex/silo-plugin-romm/internal/romm"
	"html"
	"io"
	"io/fs"
	"mime"
	"net"
	"net/http"
	"path"
	"strings"
	"sync"
	"time"
)

//go:embed ui/* emulator
var files embed.FS

type relayGrant struct {
	Owner, Session, Kind string
	Asset                string
	Game                 int64
	Expires              time.Time
}
type Server struct {
	pluginv1.UnimplementedHttpRoutesServer
	Engine   *romm.Engine
	mu       sync.Mutex
	listener net.Listener
	relay    *http.Server
	grants   map[string]relayGrant
	nonce    uint64
}

func header(r *pluginv1.HandleHTTPRequest, key string) string {
	for k, v := range r.GetHeaders() {
		if strings.EqualFold(k, key) {
			return v
		}
	}
	return ""
}
func owner(r *pluginv1.HandleHTTPRequest) (string, error) {
	user, profile := header(r, "X-Silo-User-Id"), header(r, "X-Silo-Profile-Id")
	if user == "" || profile == "" || len(user) > 128 || len(profile) > 128 {
		return "", errors.New("Select a Silo profile to open Games")
	}
	b, _ := json.Marshal([]string{user, profile})
	return string(b), nil
}
func query(r *pluginv1.HandleHTTPRequest, key string) string {
	v := r.GetQuery().AsMap()[key]
	if a, ok := v.([]any); ok && len(a) > 0 {
		v = a[0]
	}
	s, _ := v.(string)
	return s
}
func response(code int, v any) *pluginv1.HandleHTTPResponse {
	b, _ := json.Marshal(v)
	return &pluginv1.HandleHTTPResponse{StatusCode: int32(code), Headers: map[string]string{"Content-Type": "application/json", "Cache-Control": "no-store"}, Body: b}
}
func problem(err error) *pluginv1.HandleHTTPResponse {
	code := 400
	if errors.Is(err, romm.ErrUnlinked) || errors.Is(err, romm.ErrChanged) {
		code = 409
	}
	if errors.Is(err, romm.ErrUpstream) || errors.Is(err, romm.ErrUnavailable) {
		code = 502
	}
	if errors.Is(err, romm.ErrTimeout) {
		code = 504
	}
	return response(code, map[string]string{"error": err.Error()})
}
func decode(r *pluginv1.HandleHTTPRequest, out any) error {
	if len(r.GetBody()) > 900<<10 {
		return errors.New("Request too large")
	}
	return json.Unmarshal(r.GetBody(), out)
}
func (s *Server) Close() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.relay != nil {
		_ = s.relay.Close()
	}
}
func (s *Server) Handle(ctx context.Context, r *pluginv1.HandleHTTPRequest) (*pluginv1.HandleHTTPResponse, error) {
	// Leave time to serialize the response before Silo's ten-second route
	// deadline. This budget covers all upstream calls in a route, including
	// multi-step sign-in. Large content streams use the separate relay.
	ctx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	p := r.GetPath()
	method := r.GetMethod()
	if method == "" {
		method = "GET"
	}
	if strings.HasPrefix(p, "/romm/assets/") && method == "GET" {
		name := strings.TrimPrefix(p, "/romm/assets/")
		file := assetFile(name)
		if info, err := fs.Stat(files, file); err == nil && info.Size() > 1<<20 {
			own, err := owner(r)
			if err != nil {
				return response(401, map[string]string{"error": err.Error()}), nil
			}
			target, err := s.grant(relayGrant{Owner: own, Kind: "asset", Asset: file, Expires: time.Now().Add(time.Minute)})
			if err != nil {
				return problem(err), nil
			}
			return &pluginv1.HandleHTTPResponse{StatusCode: 200, Headers: map[string]string{"X-Silo-Relay-URL": target}}, nil
		}
		return asset(name), nil
	}
	own, err := owner(r)
	if err != nil {
		return response(401, map[string]string{"error": err.Error()}), nil
	}
	if method == "GET" && (p == "/romm" || p == "/romm/" || p == "/romm/play") {
		b, _ := files.ReadFile("ui/index.html")
		base := "./"
		if p == "/romm" {
			base = "./romm/"
		}
		theme := header(r, "X-Silo-Theme")
		if len(theme) > 64 || strings.ContainsAny(theme, "\"'<> &/") {
			theme = ""
		}
		scriptPolicy := "'self' 'wasm-unsafe-eval' blob:"
		if p == "/romm/play" {
			scriptPolicy += " 'unsafe-eval'"
		} // Pinned Emscripten cores compile JS wrappers dynamically.
		policy := "default-src 'self'; script-src " + scriptPolicy + "; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' blob:; object-src 'none'; base-uri 'self'"
		b = []byte(strings.NewReplacer("__CSP__", html.EscapeString(policy), "__BASE__", base, "__THEME__", html.EscapeString(theme)).Replace(string(b)))
		headers := map[string]string{"Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Content-Security-Policy": policy + "; frame-ancestors 'self'"}
		if p == "/romm/play" {
			headers["Cross-Origin-Opener-Policy"] = "same-origin"
			headers["Cross-Origin-Embedder-Policy"] = "require-corp"
		}
		return &pluginv1.HandleHTTPResponse{StatusCode: 200, Headers: headers, Body: b}, nil
	}
	var out any
	switch {
	case p == "/romm/api/sign-in/start" && method == "POST":
		var in struct{}
		err = decode(r, &in)
		if err == nil {
			out, err = s.Engine.StartSignIn(ctx, own)
		}
	case (p == "/romm/api/sign-in/poll" || p == "/romm/api/sign-in/cancel") && method == "POST":
		var in struct {
			ID string `json:"id"`
		}
		err = decode(r, &in)
		if err == nil {
			if p == "/romm/api/sign-in/poll" {
				out, err = s.Engine.PollSignIn(ctx, own, in.ID)
			} else {
				out, err = s.Engine.CancelSignIn(own, in.ID)
			}
		}
	case p == "/romm/api/connection" && method == "GET":
		out = s.Engine.Status(own)
	case p == "/romm/api/link" && method == "POST":
		var in struct {
			Token string `json:"token"`
			Code  string `json:"code"`
		}
		err = decode(r, &in)
		if err == nil {
			out, err = s.Engine.Link(ctx, own, in.Token, in.Code)
		}
	case p == "/romm/api/unlink" && method == "POST":
		err = s.Engine.Unlink(own)
		out = map[string]bool{"ok": err == nil}
	case p == "/romm/api/platforms" && method == "GET":
		out, err = s.Engine.Platforms(ctx, own)
	case p == "/romm/api/collections" && method == "GET":
		out, err = s.Engine.Collections(ctx, own)
	case p == "/romm/api/games" && method == "GET":
		out, err = s.Engine.Games(ctx, own, romm.BrowseQuery{Search: query(r, "search"), Platform: query(r, "platform"), Collection: query(r, "collection"), Offset: query(r, "offset"), Sort: query(r, "sort"), Playable: query(r, "playable") == "true", Recent: query(r, "recent") == "true", Favorite: query(r, "favorite") == "true"})
	case p == "/romm/api/game" && method == "GET":
		var id int64
		id, err = romm.ID(query(r, "id"))
		if err == nil {
			out, err = s.Engine.Detail(ctx, own, id)
		}
	case p == "/romm/api/play" && method == "POST":
		var in struct {
			ID int64 `json:"id"`
		}
		err = decode(r, &in)
		if err == nil && in.ID <= 0 {
			err = errors.New("Invalid game")
		}
		if err == nil {
			out, err = s.Engine.Play(ctx, own, in.ID)
		}
	case p == "/romm/api/session" && method == "GET":
		out, err = s.Engine.Session(own, query(r, "id"))
	case p == "/romm/api/stop" && method == "POST":
		var in struct {
			Session string `json:"session"`
		}
		err = decode(r, &in)
		if err == nil {
			s.Engine.Stop(own, in.Session)
			out = map[string]bool{"ok": true}
		}
	case p == "/romm/api/upload" && method == "POST":
		var in romm.UploadRequest
		err = decode(r, &in)
		if err == nil {
			out, err = s.Engine.Upload(ctx, own, in)
		}
	case (p == "/romm/api/content" || p == "/romm/api/art") && method == "GET":
		g := relayGrant{Owner: own, Session: query(r, "session"), Kind: query(r, "kind"), Expires: time.Now().Add(time.Minute)}
		if p == "/romm/api/art" {
			g.Kind = "art"
			g.Game, err = romm.ID(query(r, "id"))
		} else {
			_, err = s.Engine.Session(own, g.Session)
			if g.Kind != "rom" && g.Kind != "bios" && g.Kind != "saves" && g.Kind != "states" {
				err = errors.New("Invalid content kind")
			}
		}
		if err == nil {
			var target string
			target, err = s.grant(g)
			if err == nil {
				return &pluginv1.HandleHTTPResponse{StatusCode: 200, Headers: map[string]string{"X-Silo-Relay-URL": target, "Cache-Control": "no-store"}}, nil
			}
		}
	default:
		return response(404, map[string]string{"error": "Route not found"}), nil
	}
	if err != nil {
		return problem(err), nil
	}
	return response(200, out), nil
}
func assetFile(name string) string {
	if path.Clean(name) != name || strings.HasPrefix(name, "/") || strings.Contains(name, "\\") || strings.HasPrefix(name, "..") {
		return ""
	}
	if strings.HasPrefix(name, "emulator/") {
		return name
	}
	return "ui/" + name
}
func asset(name string) *pluginv1.HandleHTTPResponse {
	file := assetFile(name)
	b, err := files.ReadFile(file)
	if err != nil {
		return response(404, nil)
	}
	typ := mime.TypeByExtension(path.Ext(name))
	if strings.HasSuffix(name, ".data") {
		typ = "application/octet-stream"
	}
	if typ == "" {
		typ = "application/octet-stream"
	}
	return &pluginv1.HandleHTTPResponse{StatusCode: 200, Headers: map[string]string{"Content-Type": typ, "Cache-Control": "public, max-age=0, must-revalidate"}, Body: b}
}
func (s *Server) grant(g relayGrant) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.listener == nil {
		listener, err := net.Listen("tcp4", "127.0.0.1:0")
		if err != nil {
			return "", errors.New("Could not start game content relay")
		}
		s.listener = listener
		s.grants = map[string]relayGrant{}
		s.relay = &http.Server{Handler: http.HandlerFunc(s.serveRelay), ReadHeaderTimeout: 5 * time.Second, IdleTimeout: 30 * time.Second}
		go func() { _ = s.relay.Serve(listener) }()
	}
	for k, old := range s.grants {
		if time.Now().After(old.Expires) {
			delete(s.grants, k)
		}
	}
	if len(s.grants) >= 512 {
		return "", errors.New("Game content busy; retry shortly")
	}
	// Use an unguessable per-grant capability on a literal loopback listener.
	key := randomGrant()
	s.grants[key] = g
	return "http://" + s.listener.Addr().String() + "/" + key, nil
}
func (s *Server) serveRelay(w http.ResponseWriter, r *http.Request) {
	key := strings.TrimPrefix(r.URL.Path, "/")
	s.mu.Lock()
	g, ok := s.grants[key]
	s.mu.Unlock()
	if !ok || time.Now().After(g.Expires) || r.Method != "GET" {
		http.NotFound(w, r)
		return
	}
	if g.Kind == "asset" {
		f, err := files.Open(g.Asset)
		if err != nil {
			http.NotFound(w, r)
			return
		}
		defer f.Close()
		typ := mime.TypeByExtension(path.Ext(g.Asset))
		if typ == "" || strings.HasSuffix(g.Asset, ".data") {
			typ = "application/octet-stream"
		}
		w.Header().Set("Content-Type", typ)
		w.Header().Set("Cache-Control", "public, max-age=0, must-revalidate")
		_, _ = io.Copy(w, f)
		return
	}
	var up *http.Response
	var err error
	if g.Kind == "art" {
		up, err = s.Engine.Artwork(r.Context(), g.Owner, g.Game)
	} else {
		up, err = s.Engine.Content(r.Context(), g.Owner, g.Session, g.Kind)
	}
	if err != nil {
		http.Error(w, "Game content unavailable", http.StatusServiceUnavailable)
		return
	}
	romm.CopyContent(w, up, g.Kind)
}
func AssetPaths() []string {
	var out []string
	_ = fs.WalkDir(files, ".", func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		if strings.HasPrefix(p, "ui/") {
			p = strings.TrimPrefix(p, "ui/")
			if p == "index.html" {
				return nil
			}
		}
		out = append(out, "/romm/assets/"+p)
		return nil
	})
	return out
}

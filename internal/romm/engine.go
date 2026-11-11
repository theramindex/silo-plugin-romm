// Package romm owns account links and authenticated RomM requests. Credentials
// never cross the plugin HTTP boundary and are encrypted in the durable store.
package romm

import (
	"bytes"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

var ErrUnlinked = errors.New("Connect this Silo profile to a RomM account first")
var ErrChanged = errors.New("Account connection changed; reopen the game")
var ErrUpstream = errors.New("RomM request failed; check the connection and token scopes")
var ErrTimeout = errors.New("The RomM server timed out. Try again or ask your Silo administrator to check the RomM server connection.")
var ErrUnavailable = errors.New("Silo could not reach RomM. Try again or ask your Silo administrator to check the RomM server connection.")

func upstreamFailure(ctx context.Context, err error) error {
	if errors.Is(ctx.Err(), context.DeadlineExceeded) || errors.Is(err, context.DeadlineExceeded) {
		return ErrTimeout
	}
	return ErrUnavailable
}

type Identity struct {
	ID       int64  `json:"id"`
	Username string `json:"username"`
}
type Link struct {
	Server     string   `json:"server"`
	Identity   Identity `json:"identity"`
	Generation string   `json:"generation"`
	Ciphertext string   `json:"ciphertext"`
}
type Connection struct {
	Linked     bool     `json:"linked"`
	Configured bool     `json:"configured"`
	Identity   Identity `json:"identity"`
	Generation string   `json:"generation"`
	Namespace  string   `json:"namespace"`
}
type Engine struct {
	approvals map[string]*deviceApproval
	mu        sync.RWMutex
	dir, base string
	links     map[string]Link
	aead      cipher.AEAD
	client    *http.Client
	sessions  map[string]Session
	uploads   map[string]*Upload
}

func randomID() string {
	b := make([]byte, 24)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return base64.RawURLEncoding.EncodeToString(b)
}
func New(dir string) (*Engine, error) {
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, err
	}
	keyPath := filepath.Join(dir, "credentials.key")
	key, err := os.ReadFile(keyPath)
	if os.IsNotExist(err) {
		if _, existing := os.Stat(filepath.Join(dir, "links.json")); existing == nil {
			return nil, errors.New("Credential key is missing; restore it alongside links.json")
		}
		key = make([]byte, 32)
		if _, err = rand.Read(key); err != nil {
			return nil, err
		}
		f, e := os.OpenFile(keyPath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if e != nil {
			return nil, e
		}
		_, err = f.Write(key)
		if err == nil {
			err = f.Sync()
		}
		closeErr := f.Close()
		if err != nil {
			return nil, err
		}
		if closeErr != nil {
			return nil, closeErr
		}
	} else if err != nil {
		return nil, err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	e := &Engine{dir: dir, aead: aead, links: map[string]Link{}, sessions: map[string]Session{}, uploads: map[string]*Upload{}, client: &http.Client{Timeout: 45 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}
	data, err := os.ReadFile(filepath.Join(dir, "links.json"))
	if err == nil {
		if err = json.Unmarshal(data, &e.links); err != nil {
			return nil, err
		}
	} else if !os.IsNotExist(err) {
		return nil, err
	}
	return e, nil
}
func (e *Engine) Configure(raw string) error {
	raw = strings.TrimRight(strings.TrimSpace(raw), "/")
	if raw != "" {
		u, err := url.Parse(raw)
		if err != nil || u.Host == "" || (u.Scheme != "https" && u.Scheme != "http") || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
			return errors.New("Use a RomM HTTP or HTTPS base address without credentials, query or fragment")
		}
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.base != raw {
		e.approvals = map[string]*deviceApproval{}
		e.sessions = map[string]Session{}
		e.uploads = map[string]*Upload{}
	}
	e.base = raw
	return nil
}
func (e *Engine) persistLocked() error {
	b, err := json.Marshal(e.links)
	if err != nil {
		return err
	}
	f, err := os.CreateTemp(e.dir, "links-*.tmp")
	if err != nil {
		return err
	}
	name := f.Name()
	defer os.Remove(name)
	if _, err = f.Write(b); err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	if err := os.Rename(name, filepath.Join(e.dir, "links.json")); err != nil {
		return err
	}
	directory, err := os.Open(e.dir)
	if err != nil {
		return err
	}
	defer directory.Close()
	return directory.Sync()
}
func (e *Engine) Status(owner string) Connection {
	e.mu.RLock()
	defer e.mu.RUnlock()
	l, ok := e.links[owner]
	ok = ok && l.Server == e.base && e.base != ""
	if !ok {
		return Connection{Configured: e.base != ""}
	}
	return Connection{Linked: true, Configured: true, Identity: l.Identity, Generation: l.Generation, Namespace: l.Generation}
}
func (e *Engine) credentials(owner string) (Link, string, error) {
	e.mu.RLock()
	defer e.mu.RUnlock()
	l, ok := e.links[owner]
	if !ok || l.Server != e.base || e.base == "" {
		return Link{}, "", ErrUnlinked
	}
	b, err := base64.StdEncoding.DecodeString(l.Ciphertext)
	if err != nil || len(b) < e.aead.NonceSize() {
		return Link{}, "", ErrUnlinked
	}
	n := e.aead.NonceSize()
	plain, err := e.aead.Open(nil, b[:n], b[n:], []byte(owner+"\x00"+l.Server))
	if err != nil {
		return Link{}, "", ErrUnlinked
	}
	return l, string(plain), nil
}
func (e *Engine) Link(ctx context.Context, owner, token, code string) (Connection, error) {
	e.mu.RLock()
	base := e.base
	e.mu.RUnlock()
	if base == "" {
		return Connection{}, errors.New("Ask the Silo administrator to configure the RomM server")
	}
	token = strings.TrimSpace(token)
	if code != "" {
		var out struct {
			RawToken string `json:"raw_token"`
		}
		b, _ := json.Marshal(map[string]string{"code": strings.TrimSpace(code)})
		if err := e.request(ctx, base, "", http.MethodPost, "/api/client-tokens/exchange", bytes.NewReader(b), "application/json", &out); err != nil {
			return Connection{}, err
		}
		token = out.RawToken
	}
	if len(token) < 8 || len(token) > 8192 || strings.ContainsAny(token, "\r\n") {
		return Connection{}, errors.New("Enter a valid RomM client token or pairing code")
	}
	identity, err := e.verifyIdentity(ctx, base, token)
	if err != nil {
		return Connection{}, err
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	if base != e.base {
		return Connection{}, ErrChanged
	}
	return e.saveLinkLocked(owner, base, token, identity)
}
func (e *Engine) verifyIdentity(ctx context.Context, base, token string) (Identity, error) {
	var identity Identity
	if len(token) < 8 || len(token) > 8192 || strings.ContainsAny(token, "\r\n") {
		return identity, errors.New("Invalid RomM authorization token")
	}
	if err := e.request(ctx, base, token, http.MethodGet, "/api/users/me", nil, "", &identity); err != nil {
		return identity, err
	}
	if identity.ID <= 0 {
		return identity, errors.New("RomM did not return a valid user identity")
	}
	return identity, nil
}

// Caller holds e.mu; only verified identities may be persisted here.
func (e *Engine) saveLinkLocked(owner, base, token string, identity Identity) (Connection, error) {
	nonce := make([]byte, e.aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return Connection{}, err
	}
	l := Link{Server: base, Identity: identity, Generation: randomID()}
	l.Ciphertext = base64.StdEncoding.EncodeToString(e.aead.Seal(nonce, nonce, []byte(token), []byte(owner+"\x00"+base)))
	previous, exists := e.links[owner]
	e.links[owner] = l
	if err := e.persistLocked(); err != nil {
		if exists {
			e.links[owner] = previous
		} else {
			delete(e.links, owner)
		}
		return Connection{}, errors.New("Could not save the account connection")
	}
	e.cancelOwnerApprovalsLocked(owner)
	return Connection{Linked: true, Configured: true, Identity: identity, Generation: l.Generation, Namespace: l.Generation}, nil
}
func (e *Engine) Unlink(owner string) error {
	e.mu.Lock()
	defer e.mu.Unlock()
	old, ok := e.links[owner]
	delete(e.links, owner)
	if err := e.persistLocked(); err != nil {
		if ok {
			e.links[owner] = old
		}
		return errors.New("Could not remove account connection")
	}
	e.cancelOwnerApprovalsLocked(owner)
	return nil
}
func (e *Engine) request(ctx context.Context, base, token, method, path string, body io.Reader, contentType string, out any) error {
	r, err := http.NewRequestWithContext(ctx, method, base+path, body)
	if err != nil {
		return ErrUpstream
	}
	if token != "" {
		r.Header.Set("Authorization", "Bearer "+token)
	}
	if contentType != "" {
		r.Header.Set("Content-Type", contentType)
	}
	response, err := e.client.Do(r)
	if err != nil {
		return upstreamFailure(ctx, err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("%w (HTTP %d)", ErrUpstream, response.StatusCode)
	}
	if out != nil {
		if err = json.NewDecoder(io.LimitReader(response.Body, 8<<20)).Decode(out); err != nil {
			if ctx.Err() != nil {
				return upstreamFailure(ctx, err)
			}
			return ErrUpstream
		}
	}
	return nil
}
func (e *Engine) JSON(ctx context.Context, owner, path string, out any) error {
	l, t, err := e.credentials(owner)
	if err != nil {
		return err
	}
	return e.request(ctx, l.Server, t, "GET", path, nil, "", out)
}
func ID(raw string) (int64, error) {
	n, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || n <= 0 {
		return 0, errors.New("Invalid item identifier")
	}
	return n, nil
}

package romm

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"time"
)

var deviceScopes = []string{"me.read", "roms.read", "platforms.read", "collections.read", "firmware.read", "assets.read", "assets.write"}

type SignIn struct {
	ID              string      `json:"id"`
	Status          string      `json:"status"`
	UserCode        string      `json:"userCode,omitempty"`
	VerificationURL string      `json:"verificationUrl,omitempty"`
	LoginURL        string      `json:"loginUrl,omitempty"`
	ExpiresAt       int64       `json:"expiresAt"`
	Interval        int         `json:"interval"`
	Message         string      `json:"message,omitempty"`
	Connection      *Connection `json:"connection,omitempty"`
}
type deviceApproval struct {
	Owner, Base, Code, Token string
	Public                   SignIn
	Expires, NextPoll        time.Time
	Busy                     bool
}

func (e *Engine) cancelOwnerApprovalsLocked(owner string) {
	for id, a := range e.approvals {
		if a.Owner == owner {
			delete(e.approvals, id)
		}
	}
}
func (e *Engine) devicePost(ctx context.Context, base, path string, in, out any) (int, string, error) {
	b, _ := json.Marshal(in)
	r, err := http.NewRequestWithContext(ctx, http.MethodPost, base+path, bytes.NewReader(b))
	if err != nil {
		return 0, "", ErrUpstream
	}
	r.Header.Set("Content-Type", "application/json")
	response, err := e.client.Do(r)
	if err != nil {
		return 0, "", upstreamFailure(ctx, err)
	}
	defer response.Body.Close()
	data, err := io.ReadAll(io.LimitReader(response.Body, 65537))
	if err != nil || len(data) > 65536 {
		if ctx.Err() != nil {
			return 0, "", upstreamFailure(ctx, err)
		}
		return 0, "", ErrUpstream
	}
	if response.StatusCode >= 200 && response.StatusCode < 300 {
		if json.Unmarshal(data, out) != nil {
			return 0, "", ErrUpstream
		}
		return response.StatusCode, "", nil
	}
	var problem struct {
		Detail string `json:"detail"`
	}
	_ = json.Unmarshal(data, &problem)
	return response.StatusCode, problem.Detail, nil
}
func (e *Engine) StartSignIn(ctx context.Context, owner string) (SignIn, error) {
	e.mu.Lock()
	base := e.base
	if base == "" {
		e.mu.Unlock()
		return SignIn{}, errors.New("Ask the administrator to configure the RomM address")
	}
	if e.approvals == nil {
		e.approvals = map[string]*deviceApproval{}
	}
	for id, a := range e.approvals {
		if time.Now().After(a.Expires) {
			delete(e.approvals, id)
		}
	}
	e.cancelOwnerApprovalsLocked(owner)
	if len(e.approvals) >= 128 {
		e.mu.Unlock()
		return SignIn{}, errors.New("Too many sign-in requests; retry shortly")
	}
	a := &deviceApproval{Owner: owner, Base: base, Expires: time.Now().Add(5 * time.Minute), Public: SignIn{ID: randomID(), Status: "starting"}, Busy: true}
	e.approvals[a.Public.ID] = a
	e.mu.Unlock()
	ctx, cancel := context.WithTimeout(ctx, 12*time.Second)
	defer cancel()
	var issued struct {
		DeviceCode string `json:"device_code"`
		UserCode   string `json:"user_code"`
		Path       string `json:"verification_path_complete"`
		Expires    int    `json:"expires_in"`
		Interval   int    `json:"interval"`
	}
	code, _, err := e.devicePost(ctx, base, "/api/auth/device/init", map[string]any{"client_device_identifier": "silo-" + randomID(), "name": "Silo Games", "client": "silo", "platform": "web", "requested_scopes": deviceScopes}, &issued)
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.approvals[a.Public.ID] != a || e.base != base {
		return SignIn{}, ErrChanged
	}
	a.Busy = false
	fail := func(err error) (SignIn, error) { delete(e.approvals, a.Public.ID); return SignIn{}, err }
	if err != nil {
		return fail(err)
	}
	if code == 404 || code == 405 {
		return fail(errors.New("This RomM version does not support browser approval. Use a client token or pairing code below"))
	}
	if code < 200 || code >= 300 {
		return fail(errors.New("RomM could not start sign-in; retry shortly"))
	}
	u, parseErr := url.Parse(issued.Path)
	if parseErr != nil || u.IsAbs() || u.Host != "" || u.User != nil || u.Fragment != "" || u.Path != "/pair/device" || u.Query().Get("user_code") != issued.UserCode || issued.UserCode == "" || len(issued.UserCode) > 32 || issued.DeviceCode == "" || len(issued.DeviceCode) > 128 || issued.Expires < 1 || issued.Expires > 900 {
		return fail(errors.New("RomM returned an invalid approval response"))
	}
	a.Code = issued.DeviceCode
	a.Expires = time.Now().Add(time.Duration(issued.Expires) * time.Second)
	a.Public = SignIn{ID: a.Public.ID, Status: "pending", UserCode: issued.UserCode, VerificationURL: base + "/pair/device?user_code=" + url.QueryEscape(issued.UserCode), ExpiresAt: a.Expires.Unix(), Interval: max(1, min(60, issued.Interval))}
	a.Public.LoginURL = base + "/login?bypass_autologin=true&next=" + url.QueryEscape("/pair/device?user_code="+url.QueryEscape(issued.UserCode))
	return a.Public, nil
}
func (e *Engine) CancelSignIn(owner, id string) (SignIn, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	a, ok := e.approvals[id]
	if !ok || a.Owner != owner {
		return SignIn{}, ErrChanged
	}
	if a.Public.Status == "complete" {
		return a.Public, nil
	}
	delete(e.approvals, id)
	return SignIn{ID: id, Status: "cancelled"}, nil
}
func (e *Engine) PollSignIn(ctx context.Context, owner, id string) (SignIn, error) {
	e.mu.Lock()
	a, ok := e.approvals[id]
	if !ok || a.Owner != owner || a.Base != e.base {
		e.mu.Unlock()
		return SignIn{}, ErrChanged
	}
	if time.Now().After(a.Expires) {
		a.Public.Status = "expired"
		a.Public.Message = "Sign-in expired. Start again."
		a.Code = ""
		a.Token = ""
	}
	if a.Public.Status != "pending" || a.Busy || time.Now().Before(a.NextPoll) {
		out := a.Public
		e.mu.Unlock()
		return out, nil
	}
	a.Busy = true
	a.NextPoll = time.Now().Add(time.Duration(a.Public.Interval) * time.Second)
	token := a.Token
	deviceCode, base := a.Code, a.Base
	e.mu.Unlock()
	ctx, cancel := context.WithTimeout(ctx, 12*time.Second)
	defer cancel()
	defer func() { e.mu.Lock(); a.Busy = false; e.mu.Unlock() }()
	if token == "" {
		var issued struct {
			Token  string   `json:"access_token"`
			Scopes []string `json:"scopes"`
		}
		code, detail, err := e.devicePost(ctx, base, "/api/auth/device/token", map[string]string{"device_code": deviceCode}, &issued)
		e.mu.Lock()
		if e.approvals[id] != a || e.base != base {
			e.mu.Unlock()
			return SignIn{}, ErrChanged
		}
		if err != nil || code >= 500 || code == 429 {
			a.Public.Message = "RomM is temporarily unavailable. Retrying."
			if code == 429 {
				a.Public.Interval = min(60, a.Public.Interval+5)
				a.NextPoll = time.Now().Add(time.Duration(a.Public.Interval) * time.Second)
			}
			out := a.Public
			e.mu.Unlock()
			return out, nil
		}
		a.Public.Message = ""
		if code < 200 || code >= 300 {
			switch detail {
			case "authorization_pending":
			case "slow_down":
				a.Public.Interval = min(60, a.Public.Interval+5)
				a.NextPoll = time.Now().Add(time.Duration(a.Public.Interval) * time.Second)
			case "access_denied":
				a.Public.Status = "denied"
				a.Public.Message = "RomM access was declined. You can try again."
			case "expired_token":
				a.Public.Status = "expired"
				a.Public.Message = "Sign-in expired. Start again."
			default:
				a.Public.Status = "failed"
				a.Public.Message = "RomM could not complete sign-in. Start again."
			}
			if a.Public.Status != "pending" {
				a.Code = ""
			}
			out := a.Public
			e.mu.Unlock()
			return out, nil
		}
		approved := map[string]bool{}
		for _, scope := range issued.Scopes {
			approved[scope] = true
		}
		for _, scope := range deviceScopes {
			if !approved[scope] {
				a.Public.Status = "failed"
				a.Public.Message = "Approve all requested game and save permissions to connect."
				a.Code = ""
				out := a.Public
				e.mu.Unlock()
				return out, nil
			}
		}
		a.Token = issued.Token
		token = issued.Token
		e.mu.Unlock()
	}
	identity, err := e.verifyIdentity(ctx, base, token)
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.approvals[id] != a || e.base != base || time.Now().After(a.Expires) {
		return SignIn{}, ErrChanged
	}
	if err != nil {
		a.Public.Message = "Could not verify the approved RomM account. Retrying."
		return a.Public, nil
	}
	connection, err := e.saveLinkLocked(owner, base, token, identity)
	if err != nil {
		a.Public.Message = "Could not store the connection. Retrying."
		return a.Public, nil
	}
	a.Public.Status = "complete"
	a.Public.Message = ""
	a.Public.Connection = &connection
	a.Code = ""
	a.Token = ""
	e.approvals[id] = a
	return a.Public, nil
}

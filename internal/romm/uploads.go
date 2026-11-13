package romm

import (
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"mime/multipart"
	"net/http"
	"net/url"
	"time"
)

const maxUpload = 128 << 20
const maxChunk = 512 << 10

type Upload struct {
	Owner, Session, Kind string
	Data                 []byte
	Expires              time.Time
	Busy                 bool
	Done                 bool
	Result               Asset
}
type UploadRequest struct {
	ID      string `json:"id"`
	Session string `json:"session"`
	Kind    string `json:"kind"`
	Offset  int    `json:"offset"`
	Data    string `json:"data"`
	Final   bool   `json:"final"`
}
type UploadResult struct {
	ID       string `json:"id"`
	Offset   int    `json:"offset"`
	Complete bool   `json:"complete"`
}

func (e *Engine) Upload(ctx context.Context, owner string, in UploadRequest) (UploadResult, error) {
	if in.ID == "" {
		if in.Kind != "saves" && in.Kind != "states" {
			return UploadResult{}, errors.New("Invalid save kind")
		}
		if _, err := e.Session(owner, in.Session); err != nil {
			return UploadResult{}, err
		}
		e.mu.Lock()
		defer e.mu.Unlock()
		for k, u := range e.uploads {
			if time.Now().After(u.Expires) && !u.Busy {
				delete(e.uploads, k)
			}
		}
		if len(e.uploads) >= 8 {
			return UploadResult{}, errors.New("Too many pending uploads; retry shortly")
		}
		id := randomID()
		e.uploads[id] = &Upload{Owner: owner, Session: in.Session, Kind: in.Kind, Expires: time.Now().Add(10 * time.Minute)}
		return UploadResult{ID: id}, nil
	}
	data, err := base64.StdEncoding.DecodeString(in.Data)
	if err != nil || len(data) > maxChunk {
		return UploadResult{}, errors.New("Invalid save chunk")
	}
	e.mu.Lock()
	u, ok := e.uploads[in.ID]
	if !ok || u.Owner != owner || time.Now().After(u.Expires) || u.Busy {
		e.mu.Unlock()
		return UploadResult{}, errors.New("Save upload expired or busy")
	}
	s, ok := e.sessions[u.Session]
	l, linked := e.links[owner]
	if !ok || !linked || s.Owner != owner || s.Generation != l.Generation || s.Server != e.base || time.Now().After(s.Expires) {
		delete(e.uploads, in.ID)
		e.mu.Unlock()
		return UploadResult{}, ErrChanged
	}
	if u.Done {
		out := UploadResult{ID: in.ID, Offset: len(u.Data), Complete: true}
		e.mu.Unlock()
		return out, nil
	}
	if in.Offset < 0 || in.Offset > len(u.Data) {
		e.mu.Unlock()
		return UploadResult{}, errors.New("Save chunk offset mismatch")
	}
	if in.Offset < len(u.Data) {
		if in.Offset+len(data) > len(u.Data) || !bytes.Equal(u.Data[in.Offset:in.Offset+len(data)], data) {
			e.mu.Unlock()
			return UploadResult{}, errors.New("Conflicting save chunk")
		}
	} else {
		if len(u.Data)+len(data) > maxUpload {
			e.mu.Unlock()
			return UploadResult{}, errors.New("Save exceeds the 128 MiB limit")
		}
		total := len(data)
		for _, pending := range e.uploads {
			total += len(pending.Data)
		}
		if total > 256<<20 {
			e.mu.Unlock()
			return UploadResult{}, errors.New("Save queue is full; finish another upload first")
		}
		u.Data = append(u.Data, data...)
	}
	out := UploadResult{ID: in.ID, Offset: len(u.Data)}
	if !in.Final {
		e.mu.Unlock()
		return out, nil
	}
	if len(u.Data) == 0 {
		e.mu.Unlock()
		return out, errors.New("Empty save")
	}
	u.Busy = true
	payload := append([]byte(nil), u.Data...)
	kind := u.Kind
	e.mu.Unlock()
	// Build only server-chosen multipart names and targets. The session pins the
	// RomM user, ROM and emulator version; browser input cannot change ownership.
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	field, extension := "saveFile", "srm"
	if kind == "states" {
		field = "stateFile"
		extension = "state"
	}
	file, err := writer.CreateFormFile(field, fmt.Sprintf("silo-%d-%s.%s", s.Game.ID, s.Emulator, extension))
	if err == nil {
		_, err = file.Write(payload)
	}
	if err == nil {
		err = writer.Close()
	}
	var result Asset
	if err == nil {
		link, token, authErr := e.credentials(owner)
		err = authErr
		if err == nil && link.Generation != s.Generation {
			err = ErrChanged
		}
		if err == nil {
			q := url.Values{"rom_id": {fmt.Sprint(s.Game.ID)}, "emulator": {s.Emulator}, "overwrite": {"true"}, "slot": {"autosave"}}
			err = e.request(ctx, link.Server, token, http.MethodPost, "/api/"+kind+"?"+q.Encode(), &body, writer.FormDataContentType(), &result)
			if err == nil && (result.ROM != s.Game.ID || result.User != link.Identity.ID || result.Emulator != s.Emulator) {
				err = ErrUpstream
			}
		}
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	u.Busy = false
	if err != nil {
		return out, err
	}
	u.Done = true
	u.Result = result
	out.Complete = true
	// Keep a compact receipt so retrying the final chunk never creates a second
	// remote asset; the byte count is returned to the caller for acknowledgement.
	if current, ok := e.sessions[s.ID]; ok {
		if kind == "saves" {
			current.SaveID = result.ID
		} else {
			current.StateID = result.ID
		}
		e.sessions[s.ID] = current
	}
	return out, nil
}

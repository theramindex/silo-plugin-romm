package romm

import "context"

// Detail reports compatible progress without reserving a playback session.
type GameDetail struct {
	Game
	ProgressKnown   bool `json:"progress_known"`
	ResumeAvailable bool `json:"resume_available"`
}

type compatibleProgress struct{ saveID, stateID int64 }

func (e *Engine) compatibleProgress(ctx context.Context, owner string, g Game, userID int64) (compatibleProgress, error) {
	var result compatibleProgress
	for _, kind := range []string{"saves", "states"} {
		assets, err := e.assets(ctx, owner, kind, g.ID)
		if err != nil {
			return compatibleProgress{}, err
		}
		var newest Asset
		for _, a := range assets {
			if a.ROM == g.ID && a.User == userID && a.Emulator == g.Core+"-"+EmulatorVersion && a.Updated >= newest.Updated {
				newest = a
			}
		}
		if kind == "saves" {
			result.saveID = newest.ID
		} else {
			result.stateID = newest.ID
		}
	}
	return result, nil
}

func (e *Engine) Detail(ctx context.Context, owner string, id int64) (GameDetail, error) {
	link, _, err := e.credentials(owner)
	if err != nil {
		return GameDetail{}, err
	}
	g, err := e.Game(ctx, owner, id)
	if err != nil {
		return GameDetail{}, err
	}
	out := GameDetail{Game: g}
	if g.Core == "" || (g.OnDisk != nil && !*g.OnDisk) {
		out.ProgressKnown = true
		return out, nil
	}
	progress, progressErr := e.compatibleProgress(ctx, owner, g, link.Identity.ID)
	e.mu.RLock()
	current, ok := e.links[owner]
	unchanged := ok && current.Generation == link.Generation && e.base == link.Server
	e.mu.RUnlock()
	if !unchanged {
		return GameDetail{}, ErrChanged
	}
	if progressErr == nil {
		out.ProgressKnown = true
		out.ResumeAvailable = progress.saveID > 0 || progress.stateID > 0
	}
	return out, nil
}

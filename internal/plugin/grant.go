package plugin

import (
	"crypto/rand"
	"encoding/hex"
)

func randomGrant() string {
	var b [24]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b[:])
}

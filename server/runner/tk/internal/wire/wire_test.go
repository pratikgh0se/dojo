//go:build dojo_wiretest

package wire

import (
	"bytes"
	"testing"
)

func TestParseKeyAcceptsOnlyAKeyLine(t *testing.T) {
	good := bytes.Repeat([]byte("a1"), KeyLen/2)
	for _, c := range []struct {
		line string
		ok   bool
	}{
		{string(good) + "\n", true},
		{string(good), false},
		{string(good) + " 1099511627776 1000000 1099511627776\n", false},
		{"k 1099511627776 1000000\n", false},
		{string(bytes.ToUpper(good)) + "\n", false},
		{"", false},
		{string(good[:KeyLen-1]) + "\n\n", false},
	} {
		line := []byte(c.line)
		k, ok := ParseKey(line)
		if ok != c.ok {
			t.Errorf("ParseKey(%q) ok = %v, want %v", c.line, ok, c.ok)
		}
		if ok && !bytes.Equal(k, good) {
			t.Errorf("ParseKey(%q) = %q", c.line, k)
		}
		if !bytes.Equal(line, make([]byte, len(line))) {
			t.Errorf("ParseKey(%q) left the line buffer as %q, want it zeroed", c.line, line)
		}
	}
}

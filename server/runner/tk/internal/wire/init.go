//go:build !dojo_wiretest

package wire

// The real init. Tests of this package build with -tags dojo_wiretest, so their binary does not try
// to remove itself or read a key from fd 5.
func init() { start() }

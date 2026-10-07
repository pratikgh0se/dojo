// dojo-ref
package main

func numDecodings(s string) int {
	if len(s) == 0 {
		return 0
	}
	prev2, prev1 := 1, 0
	if s[0] != '0' {
		prev1 = 1
	}
	for i := 2; i <= len(s); i++ {
		cur := 0
		if s[i-1] != '0' {
			cur += prev1
		}
		if two := (s[i-2]-'0')*10 + (s[i-1] - '0'); s[i-2] != '0' && two <= 26 {
			cur += prev2
		}
		prev2, prev1 = prev1, cur
	}
	return prev1
}

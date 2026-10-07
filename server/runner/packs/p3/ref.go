// dojo-ref
package main

func lengthOfLongestSubstring(s string) int {
	last := map[byte]int{}
	best, lo := 0, 0
	for i := 0; i < len(s); i++ {
		if j, ok := last[s[i]]; ok && j >= lo {
			lo = j + 1
		}
		last[s[i]] = i
		if i-lo+1 > best {
			best = i - lo + 1
		}
	}
	return best
}

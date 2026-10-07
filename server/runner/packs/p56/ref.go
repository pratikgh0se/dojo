// dojo-ref
package main

import "sort"

func merge(intervals [][]int) [][]int {
	sort.Slice(intervals, func(i, j int) bool { return intervals[i][0] < intervals[j][0] })
	out := [][]int{}
	for _, iv := range intervals {
		if n := len(out); n > 0 && iv[0] <= out[n-1][1] {
			if iv[1] > out[n-1][1] {
				out[n-1][1] = iv[1]
			}
		} else {
			out = append(out, []int{iv[0], iv[1]})
		}
	}
	return out
}

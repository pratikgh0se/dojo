// dojo-ref
package main

import "sort"

func findKthLargest(nums []int, k int) int {
	s := append([]int(nil), nums...)
	sort.Sort(sort.Reverse(sort.IntSlice(s)))
	return s[k-1]
}

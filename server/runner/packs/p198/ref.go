// dojo-ref
package main

func rob(nums []int) int {
	prev, cur := 0, 0
	for _, x := range nums {
		take := prev + x
		if cur > take {
			take = cur
		}
		prev, cur = cur, take
	}
	return cur
}

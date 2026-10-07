// dojo-ref
package main

func canJump(nums []int) bool {
	reach := 0
	for i, x := range nums {
		if i > reach {
			return false
		}
		if i+x > reach {
			reach = i + x
		}
	}
	return true
}

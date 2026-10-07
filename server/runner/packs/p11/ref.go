// dojo-ref
package main

func maxArea(height []int) int {
	l, r, best := 0, len(height)-1, 0
	for l < r {
		h := height[l]
		if height[r] < h {
			h = height[r]
		}
		if h*(r-l) > best {
			best = h * (r - l)
		}
		if height[l] < height[r] {
			l++
		} else {
			r--
		}
	}
	return best
}

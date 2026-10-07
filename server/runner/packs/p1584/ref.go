// dojo-ref
package main

func minCostConnectPoints(points [][]int) int {
	n := len(points)
	abs := func(x int) int {
		if x < 0 {
			return -x
		}
		return x
	}
	in := make([]bool, n)
	best := make([]int, n)
	for i := range best {
		best[i] = 1 << 62
	}
	best[0] = 0
	total := 0
	for k := 0; k < n; k++ {
		u := -1
		for i := 0; i < n; i++ {
			if !in[i] && (u < 0 || best[i] < best[u]) {
				u = i
			}
		}
		in[u] = true
		total += best[u]
		for v := 0; v < n; v++ {
			if d := abs(points[u][0]-points[v][0]) + abs(points[u][1]-points[v][1]); !in[v] && d < best[v] {
				best[v] = d
			}
		}
	}
	return total
}

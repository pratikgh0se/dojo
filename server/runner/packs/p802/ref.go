// dojo-ref
package main

func eventualSafeNodes(graph [][]int) []int {
	color := make([]int, len(graph)) // 0 new, 1 on the stack, 2 safe
	var safe func(u int) bool
	safe = func(u int) bool {
		if color[u] > 0 {
			return color[u] == 2
		}
		color[u] = 1
		for _, v := range graph[u] {
			if !safe(v) {
				return false
			}
		}
		color[u] = 2
		return true
	}
	out := []int{}
	for i := range graph {
		if safe(i) {
			out = append(out, i)
		}
	}
	return out
}

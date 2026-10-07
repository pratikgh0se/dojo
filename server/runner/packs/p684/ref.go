// dojo-ref
package main

func findRedundantConnection(edges [][]int) []int {
	parent := make([]int, len(edges)+1)
	for i := range parent {
		parent[i] = i
	}
	var find func(x int) int
	find = func(x int) int {
		if parent[x] != x {
			parent[x] = find(parent[x])
		}
		return parent[x]
	}
	var last []int
	for _, e := range edges {
		a, b := find(e[0]), find(e[1])
		if a == b {
			last = e
		} else {
			parent[b] = a
		}
	}
	return last
}

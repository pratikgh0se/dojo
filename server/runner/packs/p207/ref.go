// dojo-ref
package main

func canFinish(numCourses int, prerequisites [][]int) bool {
	indeg := make([]int, numCourses)
	adj := make([][]int, numCourses)
	for _, p := range prerequisites {
		adj[p[1]] = append(adj[p[1]], p[0])
		indeg[p[0]]++
	}
	q := []int{}
	for i, d := range indeg {
		if d == 0 {
			q = append(q, i)
		}
	}
	done := 0
	for len(q) > 0 {
		u := q[0]
		q = q[1:]
		done++
		for _, v := range adj[u] {
			indeg[v]--
			if indeg[v] == 0 {
				q = append(q, v)
			}
		}
	}
	return done == numCourses
}

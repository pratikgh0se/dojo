// dojo-ref
package main

import "container/heap"

type dojoItem struct{ v, d int }
type dojoPQ []dojoItem

func (q dojoPQ) Len() int            { return len(q) }
func (q dojoPQ) Less(i, j int) bool  { return q[i].d < q[j].d }
func (q dojoPQ) Swap(i, j int)       { q[i], q[j] = q[j], q[i] }
func (q *dojoPQ) Push(x interface{}) { *q = append(*q, x.(dojoItem)) }
func (q *dojoPQ) Pop() interface{} {
	o := *q
	x := o[len(o)-1]
	*q = o[:len(o)-1]
	return x
}

func networkDelayTime(times [][]int, n int, k int) int {
	adj := make([][][2]int, n+1)
	for _, t := range times {
		adj[t[0]] = append(adj[t[0]], [2]int{t[1], t[2]})
	}
	dist := make([]int, n+1)
	for i := range dist {
		dist[i] = -1
	}
	q := &dojoPQ{{k, 0}}
	for q.Len() > 0 {
		it := heap.Pop(q).(dojoItem)
		if dist[it.v] >= 0 {
			continue
		}
		dist[it.v] = it.d
		for _, e := range adj[it.v] {
			if dist[e[0]] < 0 {
				heap.Push(q, dojoItem{e[0], it.d + e[1]})
			}
		}
	}
	best := 0
	for i := 1; i <= n; i++ {
		if dist[i] < 0 {
			return -1
		}
		if dist[i] > best {
			best = dist[i]
		}
	}
	return best
}

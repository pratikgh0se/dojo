// dojo-ref
package main

func diameterOfBinaryTree(root *TreeNode) int {
	best := 0
	var height func(n *TreeNode) int
	height = func(n *TreeNode) int {
		if n == nil {
			return 0
		}
		l, r := height(n.Left), height(n.Right)
		if l+r > best {
			best = l + r
		}
		if l > r {
			return l + 1
		}
		return r + 1
	}
	height(root)
	return best
}

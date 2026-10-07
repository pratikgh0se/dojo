// dojo-ref
package main

func stoneGame(piles []int) bool {
	n := len(piles)
	dp := make([][]int, n) // dp[i][j]: the mover's best margin on piles[i..j]
	for i := range dp {
		dp[i] = make([]int, n)
		dp[i][i] = piles[i]
	}
	for l := 2; l <= n; l++ {
		for i := 0; i+l-1 < n; i++ {
			j := i + l - 1
			a, b := piles[i]-dp[i+1][j], piles[j]-dp[i][j-1]
			if a > b {
				dp[i][j] = a
			} else {
				dp[i][j] = b
			}
		}
	}
	return dp[0][n-1] > 0
}

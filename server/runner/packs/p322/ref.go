// dojo-ref
package main

func coinChange(coins []int, amount int) int {
	const inf = 1 << 30
	dp := make([]int, amount+1)
	for a := 1; a <= amount; a++ {
		dp[a] = inf
		for _, c := range coins {
			if c <= a && dp[a-c]+1 < dp[a] {
				dp[a] = dp[a-c] + 1
			}
		}
	}
	if dp[amount] >= inf {
		return -1
	}
	return dp[amount]
}

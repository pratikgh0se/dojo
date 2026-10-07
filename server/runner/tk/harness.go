package tk

// The Dojo runner's side of a run. The generated main (dojo_main.go) calls DojoHarness exactly once
// with one closure per case; everything that reports to the runner lives here, behind the run key,
// rather than in package main, where the learner's file could call it.

import (
	"runtime"
	"runtime/debug"
	"strconv"

	"dojo/tk/internal/wire"
)

var harnessUsed bool

func result(s string) { wire.Result(s) }

func quote(s string) string { return string(appendJSON(nil, s)) }

func runCase(id int, f func() string) {
	defer func() {
		if r := recover(); r != nil {
			Flush()
			msg := "panic"
			switch v := r.(type) {
			case error:
				msg = v.Error()
			case string:
				msg = v
			case int:
				msg = strconv.Itoa(v)
			}
			result(`{"id":` + strconv.Itoa(id) + `,"panic":` + quote(msg) + `,"stack":` + quote(string(debug.Stack())) + `}`)
		}
	}()
	got := f()
	result(`{"id":` + strconv.Itoa(id) + `,"got":` + got + `}`)
}

// DojoHarness is the Dojo runner's entry point, called once by the generated main. It is not part of
// the toolkit: a call from anywhere else panics. The run's limits are applied earlier, by
// internal/wire's init, before any of the learner's code runs.
func DojoHarness(cases []func() string) {
	pc, _, _, ok := runtime.Caller(1)
	fn := runtime.FuncForPC(pc)
	if !ok || fn == nil || fn.Name() != "main.main" || harnessUsed {
		panic("tk.DojoHarness is for the Dojo runner only")
	}
	harnessUsed = true
	for k, f := range cases {
		caseStart(k + 1)
		runCase(k+1, f)
		Flush()
	}
	Flush()
	if wire.OverMemory() {
		wire.Stop("memory")
	}
	result(`{"done":true}`)
}

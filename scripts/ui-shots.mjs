#!/usr/bin/env node
// Dev aid for the UI build (not a test): serves dist/ with dojo-server --fake on a scratch DOJO_HOME and
// screenshots the Do workbench, the DP trace and the family states at the spec widths, for side-by-side
// comparison with docs/superpowers/contracts/ui/mockups. Usage:
//   node scripts/ui-shots.mjs <outDir> [state ...]   (port: UI_SHOTS_PORT, default 8987; never 8787)
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium, webkit, devices } from '@playwright/test'

const OUT = process.argv[2] ?? 'shots'
const ONLY = new Set(process.argv.slice(3))
const PORT = Number(process.env.UI_SHOTS_PORT ?? 8987)
if (PORT === 8787) throw new Error('never 8787')
const WIDTHS = (process.env.UI_SHOTS_WIDTHS ?? '1280,834,393,375').split(',').map(Number)
const ENGINE = process.env.UI_SHOTS_ENGINE ?? 'chromium'
mkdirSync(OUT, { recursive: true })
const home = mkdtempSync(join(tmpdir(), 'dojo-ui-shots-'))
const srv = spawn(process.execPath, ['server/dojo-server.mjs', '--fake', '--dist', process.env.UI_SHOTS_DIST ?? 'dist'], { env: { ...process.env, DOJO_HOME: home, DOJO_PORT: String(PORT) }, stdio: 'ignore' })
const URL = `http://127.0.0.1:${PORT}`
for (let i = 0; i < 100; i++) { try { if ((await fetch(`${URL}/db/health`)).ok) break } catch { /* not yet */ } await new Promise(r => setTimeout(r, 100)) }
const token = readFileSync(join(home, 'writer.token'), 'utf8').trim()

const P91_BOTH = `package main

import "dojo/tk"

var memo map[int]int
var t *tk.Tab
var str string

// f(i) = decodings of the first i characters
func f(i int) int {
	if v, ok := memo[i]; ok {
		tk.Hit("f", i)
		return v
	}
	tk.Enter("f", i)
	v := 0
	if i <= 1 {
		v = 1
		if i == 1 && str[0] == '0' {
			v = 0
		}
		t.Set(0, i, v)
	} else {
		one := str[i-1] != '0'
		two := str[i-2] == '1' || (str[i-2] == '2' && str[i-1] <= '6')
		if one {
			v += f(i - 1)
		}
		if two {
			v += f(i - 2)
		}
		switch {
		case one && two:
			t.Set(0, i, v, tk.Dep(0, i-1), tk.Dep(0, i-2), tk.Rule("{0} + {1}"))
		case one:
			t.Set(0, i, v, tk.Dep(0, i-1), tk.Rule("{0}"))
		case two:
			t.Set(0, i, v, tk.Dep(0, i-2), tk.Rule("{0}"))
		default:
			t.Set(0, i, 0)
		}
	}
	memo[i] = v
	tk.Exit(v)
	return v
}

func numDecodings(s string) int {
	str = s
	memo = map[int]int{}
	t = tk.Table("dp", 1, len(s)+1)
	tk.Link("f", "dp")
	return f(len(s))
}
`
const P1143 = `package main

import "dojo/tk"

func longestCommonSubsequence(a string, b string) int {
	t := tk.Table("dp", len(a)+1, len(b)+1)
	for i := 0; i <= len(a); i++ {
		t.Set(i, 0, 0)
	}
	for j := 1; j <= len(b); j++ {
		t.Set(0, j, 0)
	}
	for i := 1; i <= len(a); i++ {
		for j := 1; j <= len(b); j++ {
			if a[i-1] == b[j-1] {
				t.Set(i, j, t.Get(i-1, j-1)+1, tk.Dep(i-1, j-1), tk.Rule("{0} + 1"))
			} else {
				x, y := t.Get(i-1, j), t.Get(i, j-1)
				v := x
				if y > v {
					v = y
				}
				t.Set(i, j, v, tk.Dep(i-1, j), tk.Dep(i, j-1), tk.Rule("max({0}, {1})"))
			}
		}
	}
	return t.Get(len(a), len(b))
}
`
const { GO_VF } = await import('../tests/helpers/visualSolutions.ts').catch(() => ({ GO_VF: null }))

async function ready(page) {
  await page.goto(`${URL}/#writer=${token}`)
  const date = page.getByRole('textbox', { name: 'Start date' })
  if (await date.waitFor({ timeout: 15_000 }).then(() => true, () => false)) {
    await date.fill('2026-10-05')
    await page.getByRole('button', { name: 'Start the plan ▸' }).click()
    await date.waitFor({ state: 'hidden' })
    await page.getByTestId('save-status').filter({ hasText: 'Saved' }).waitFor()
  }
}
async function runCode(page, id, code, mode = 'Run') {
  await page.goto(`${URL}/do/${id}`)
  await page.getByRole('textbox', { name: 'Code' }).fill(code)
  await page.waitForTimeout(800)
  await page.getByRole('button', { name: mode, exact: true }).click()
  await page.getByTestId('run-status').filter({ hasText: /Passed|Failed|error/ }).waitFor({ timeout: 90_000 })
  await page.getByTestId('dp-view').waitFor()
}
async function seek(page, testid, text) {
  await page.getByTestId('dp-scrubber').press('Home')
  await page.evaluate(async ({ testid, text }) => {
    const root = document.querySelector('[data-testid="dp-view"]')
    const next = [...root.querySelectorAll('button')].find(b => b.textContent === 'Next step')
    for (let i = 0; i < 5000; i++) {
      const el = root.querySelector(`[data-testid="${testid}"]`)
      if ((el?.textContent ?? '').replace(/\s+/g, ' ').trim() === text) return
      if (next.disabled) return
      next.click()
      await new Promise(r => setTimeout(r, 0))
    }
  }, { testid, text })
}

async function aiTicket() {
  const st = await (await fetch(`${URL}/db/state`)).json()
  const t = (st.tables.tickets ?? []).filter(x => x.track === 'ai' && x.sprint === 1 && x.kind === 'watch').sort((a, b) => (a.order ?? 0) - (b.order ?? 0))[0]
    ?? (st.tables.tickets ?? []).find(x => x.track === 'ai' && x.sprint === 1)
  return t.id
}
async function openPlan(page) {
  await page.goto(`${URL}/do/${await aiTicket()}`)
  await page.getByTestId('start-session').click()
  await page.getByTestId('plan-dialog').waitFor()
}
async function startStudy(page) {
  await openPlan(page)
  await page.getByTestId('plan-dialog').getByRole('textbox').first().fill('Watch chapters 1–3 and pause to predict each slope')
  await page.getByTestId('plan-start').click()
  await page.getByTestId('session-panel').waitFor()
}

const STATES = {
  'shell-today': async page => { await page.goto(`${URL}/`); await page.waitForTimeout(500); return 'page' },
  'shell-board': async page => { await page.goto(`${URL}/board`); await page.waitForTimeout(500); return 'page' },
  'shell-settings': async page => { await page.goto(`${URL}/settings`); await page.waitForTimeout(500); return 'page' },
  'dialog-plan': async page => { await openPlan(page); return 'viewport' },
  'do-session-brief': async page => { await startStudy(page); return 'page' },
  'focus-mode': async page => { await startStudy(page); await page.getByTestId('session-focus').click(); await page.getByTestId('focus-screen').waitFor(); return 'viewport' },
  'do-workbench': async page => { await runCode(page, 'p91', P91_BOTH); await seek(page, 'dp-recurrence', 'dp[3] = dp[2] + dp[1] = 2 + 1 = 3'); return 'page' },
  'dp-trace-a': async page => { await runCode(page, 'p91', P91_BOTH); await seek(page, 'dp-recurrence', 'dp[3] = dp[2] + dp[1] = 2 + 1 = 3'); return 'dp-view' },
  'dp-trace-b': async page => {
    await runCode(page, 'p91', P91_BOTH); await seek(page, 'dp-recurrence', 'dp[3] = dp[2] + dp[1] = 2 + 1 = 3')
    await page.getByTestId('dp-cell-0-1').click(); return 'dp-view'
  },
  'dp-trace-d': async page => { await runCode(page, 'p1143', P1143); await seek(page, 'dp-recurrence', 'dp[3][2] = dp[2][1] + 1 = 1 + 1 = 2'); return 'dp-view' },
  'fam-dijkstra': async page => { await runCode(page, 'p743', GO_VF.vf01[1], 'Submit'); await seek(page, 'graph-caption', 'dist[2] = 3 (via 3)'); return 'dp-view' },
  'fam-array': async page => { await runCode(page, 'p3', GO_VF.vf05[1]); await seek(page, 'array-caption', 'window [1..3] (len 3)'); return 'dp-view' },
  'fam-dsu': async page => { await runCode(page, 'p684', GO_VF.vf03[1]); await seek(page, 'dsu-caption', 'union(1, 4): already joined (root 1)'); return 'dp-view' },
  'fam-intervals': async page => { await runCode(page, 'p56', GO_VF.vf08[1]); await seek(page, 'intervals-caption', 'out[0] = [1,6]'); return 'dp-view' },
  'fam-game': async page => { await runCode(page, 'p877', GO_VF.vf10[1]); return 'dp-view' },
  'fam-list': async page => { await runCode(page, 'p206', GO_VF.vf07[1]); await seek(page, 'list-caption', 'next(1) = 0'); return 'dp-view' },
  'fam-tree': async page => { await runCode(page, 'p543', GO_VF.vf09[1]); await seek(page, 'tree-caption', '1 (2): h=2'); return 'dp-view' },
  'fam-search': async page => { await runCode(page, 'p875', GO_VF.vf06[1]); await seek(page, 'search-caption', 'lo=1 mid=3 hi=6 · pred(3)=false → lo=4'); return 'dp-view' },
  'do-unknown-ticket': async page => { await page.goto(`${URL}/do/p-nope`); await page.getByText('No ticket').waitFor(); return 'page' },
  'shell-progress': async page => { await page.goto(`${URL}/progress`); await page.waitForTimeout(800); return 'page' },
  'shell-dsa': async page => { await page.goto(`${URL}/dsa?topic=2`); await page.waitForTimeout(1200); return 'page' },
  'shell-atlas': async page => { await page.goto(`${URL}/atlas?pattern=topo-sort`); await page.waitForTimeout(800); return 'page' },
  'shell-ai': async page => { await page.goto(`${URL}/ai`); await page.waitForTimeout(800); return 'page' },
  'shell-mentors': async page => { await page.goto(`${URL}/mentors`); await page.waitForTimeout(500); return 'page' },
  'shell-ritual': async page => { await page.goto(`${URL}/ritual`); await page.waitForTimeout(500); return 'page' },
  'today-drawers': async page => {
    await page.goto(`${URL}/`)
    for (const id of ['drawer-tasks', 'drawer-dsa']) await page.getByTestId(id).getByRole('button', { expanded: false }).first().click().catch(() => {})
    await page.waitForTimeout(400); return 'page'
  },
  'design-close': async page => {
    // one server for every width: a later width finds the session already in the close step
    await page.goto(`${URL}/designs/session/d-ratelimit`)
    const phase = page.getByTestId('session-phase')
    if (await page.getByTestId('session-close').waitFor({ timeout: 4000 }).then(() => true, () => false)) return 'page'
    await phase.or(page.getByRole('button', { name: 'Start · 45 min' })).first().waitFor()
    await page.getByRole('radio', { name: 'Solo' }).check()
    await page.getByRole('button', { name: 'Start · 45 min' }).click()
    await page.getByRole('button', { name: 'End drawing' }).click()
    await page.getByRole('dialog', { name: 'End drawing now?' }).waitFor()
    await page.waitForTimeout(400)
    await page.screenshot({ path: join(OUT, `dialog-design-end-${page.viewportSize().width}.png`) })
    await page.getByRole('dialog', { name: 'End drawing now?' }).getByRole('button', { name: 'End drawing' }).click()
    await page.getByTestId('session-close').waitFor(); return 'page'
  },
  // README screenshots (docs/screenshots): the sample plan on a scratch DOJO_HOME, fake AI, no personal data.
  'readme-today': async page => { await page.goto(`${URL}/`); await page.waitForTimeout(800); return 'page' },
  'readme-board': async page => { await page.goto(`${URL}/board`); await page.waitForTimeout(800); return 'page' },
  'readme-do-go': async page => { await runCode(page, 'p91', P91_BOTH); await seek(page, 'dp-recurrence', 'dp[3] = dp[2] + dp[1] = 2 + 1 = 3'); return 'page' },
  // the fake AI's picture is labelled [fake:picture]; the Atlas walkthrough is the same lab player with real content
  'readme-picture': async page => {
    await page.goto(`${URL}/atlas?pattern=topo-sort`)
    await page.getByRole('button', { name: 'Play', exact: true }).first().click()
    const player = page.getByTestId('lab-player').first()
    await player.waitFor()
    for (let i = 0; i < 5; i++) await player.getByRole('button', { name: 'Step forward' }).click()
    return 'page'
  },
  'readme-designs': async page => { await page.goto(`${URL}/designs`); await page.waitForTimeout(1000); return 'page' },
  'readme-progress': async page => { await page.goto(`${URL}/progress`); await page.waitForTimeout(1000); return 'page' },
  'fam-topo': async page => { await runCode(page, 'p207', GO_VF.vf02[1], 'Submit'); await seek(page, 'graph-caption', 'mark 3: in 1'); return 'dp-view' },
}

const browserType = ENGINE === 'webkit' ? webkit : chromium
const browser = await browserType.launch()
try {
  for (const [name, fn] of Object.entries(STATES)) {
    if (ONLY.size && !ONLY.has(name)) continue
    for (const w of WIDTHS) {
      const device = ENGINE !== 'webkit' ? {} : w < 768 ? devices['iPhone 13'] : w < 1100 ? devices['iPad Pro 11'] : {}
      const ctx = await browser.newContext({ timezoneId: 'Asia/Kolkata', ...device, viewport: { width: w, height: 900 } })
      const page = await ctx.newPage()
      await page.clock.setSystemTime(new Date('2026-10-06T10:00:00+05:30'))
      try {
        await ready(page)
        const what = await fn(page)
        await page.waitForTimeout(300)
        const file = join(OUT, `${name}-${w}${ENGINE === 'webkit' ? '-webkit' : ''}.png`)
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
        if (process.env.UI_SHOTS_PROBE) console.log(JSON.stringify(await page.evaluate(process.env.UI_SHOTS_PROBE)))
        if (what !== 'viewport') await page.evaluate(() => window.scrollTo(0, 0))
        if (what === 'page') await page.screenshot({ path: file, fullPage: true })
        else if (what === 'viewport') await page.screenshot({ path: file })
        else await page.getByTestId(what).screenshot({ path: file })
        console.log(`${file}${overflow > 0 ? `  PAGE OVERFLOW ${overflow}px` : ''}`)
      } catch (e) {
        console.log(`${name}-${w}: FAILED ${String(e).split('\n')[0]}`)
        await page.screenshot({ path: join(OUT, `FAILED-${name}-${w}.png`) }).catch(() => {})
      } finally {
        await ctx.close()
      }
    }
  }
} finally {
  await browser.close()
  srv.kill()
  rmSync(home, { recursive: true, force: true })
}

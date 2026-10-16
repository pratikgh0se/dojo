#!/usr/bin/env python3
"""Authoring gate for lab content (an interim stand-in for `npm run lab:verify`). Python standard library only.

usage: python3 scripts/lab-content-check.py <labId>|--all [--through N] [--run]
  static rules always; --run also runs `make check` on the template (every check must fail or skip)
  and on the template with reference/ copied over it (every check must pass, within timeoutSec / 3).
  --through N considers only the first N milestones (a lab authored in halves).
"""
import filecmp
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LABS = os.path.join(ROOT, "plan-src", "labs")
BASE = os.path.join(LABS, "b1-tokensim", "template", "checks")
BANNED_MAKE = (".ONESHELL", ".RECIPEPREFIX", "$" + "(file ", "::" + "=")
failures = []


def fail(lab, rule, detail):
    failures.append("FAIL %s: %s: %s" % (lab, rule, detail))


def read(path):
    with open(path) as f:
        return f.read()


def ticket_ids(lab):
    """Ids (ai.<node lower>.<role>[.<n>]) of the tickets whose lab.id is `lab`, from plan-src/tickets."""
    found = []
    tdir = os.path.join(ROOT, "plan-src", "tickets")
    for name in sorted(os.listdir(tdir)):
        if not name.endswith(".json"):
            continue
        node = name[:-5].lower()
        for t in json.loads(read(os.path.join(tdir, name))):
            tid = "ai.%s.%s" % (node, t["role"]) + (".%d" % t["n"] if t.get("n") else "")
            if (t.get("lab") or {}).get("id") == lab:
                found.append(tid)
    return found


def static(lab, through):
    d = os.path.join(LABS, lab)
    tpl, ref = os.path.join(d, "template"), os.path.join(d, "reference")
    try:
        j = json.loads(read(os.path.join(d, "lab.json")))
    except Exception as e:
        return fail(lab, "lab.json", str(e))
    ms = j["milestones"][:through] if through else j["milestones"]
    # 1. header fields
    if j.get("id") != lab or j.get("lang") != "python" or not isinstance(j.get("version"), int) or j.get("repo") != "ai-platform-lab" or j.get("path") != "labs/" + lab:
        fail(lab, "header", "id, lang, version, repo or path is wrong")
    if not (isinstance(j.get("timeoutSec"), int) and 1 <= j["timeoutSec"] <= 900):
        fail(lab, "timeoutSec", "must be a whole number from 1 to 900")
    if not through and j["closingTicket"] != j["tickets"][-1]:
        fail(lab, "closingTicket", "must be the last entry of tickets")
    # 2. tickets match the plan and the sequence
    seq = json.loads(read(os.path.join(ROOT, "plan-src", "sequence.json")))["1"]
    want = sorted(ticket_ids(lab), key=seq.index)
    got = [m["ticket"] for m in j["milestones"]]
    if not through and (got != want or j["tickets"] != want):
        fail(lab, "tickets", "milestones %s, tickets %s, plan %s" % (got, j["tickets"], want))
    elif through and got[:through] != want[:through]:
        fail(lab, "tickets", "first %d milestones %s differ from the plan %s" % (through, got[:through], want[:through]))
    # 3. milestones and hints
    all_ids = []
    for m in ms:
        ids = m["checkIds"]
        all_ids += ids
        if not ids:
            fail(lab, "milestone", m["ticket"] + " has no checkIds")
        if [h["rung"] for h in m["hints"]] != [1, 2, 3] or not all(h.get("text", "").strip() for h in m["hints"]):
            fail(lab, "hints", m["ticket"] + ": need rungs 1, 2, 3 each with text")
            continue
        if "ref" in m["hints"][0] or "ref" in m["hints"][1]:
            fail(lab, "hints", m["ticket"] + ": only rung 3 has a ref")
        r = m["hints"][2].get("ref")
        rf = os.path.join(ref, r["file"]) if r else None
        if not r or not os.path.isfile(rf):
            fail(lab, "hint ref", "%s: reference/%s is not a file" % (m["ticket"], r and r["file"]))
        else:
            n = len(read(rf).split("\n")) - (1 if read(rf).endswith("\n") else 0)
            if not (1 <= r["from"] <= r["to"] <= n and r["to"] - r["from"] + 1 <= 40):
                fail(lab, "hint ref", "%s: lines %s-%s of %d (at most 40)" % (m["ticket"], r["from"], r["to"], n))
    if len(set(all_ids)) != len(all_ids):
        fail(lab, "checkIds", "a check id is listed twice")
    if not through and not (3 <= len(j["rubric"]) <= 5 and len({r["id"] for r in j["rubric"]}) == len(j["rubric"]) and all(r["text"].strip() for r in j["rubric"])):
        fail(lab, "rubric", "3 to 5 items with unique ids and text")
    # 5. check ids in the check modules equal the declared ones
    modules = sorted(f for f in os.listdir(os.path.join(tpl, "checks")) if re.match(r"m\d\d_.*\.py$", f))
    found = {}
    for f in modules:
        for cid in re.findall(r'@check\(\s*"([^"]+)"', read(os.path.join(tpl, "checks", f))):
            found[cid] = int(f[1:3])
    if set(found) != set(all_ids):
        fail(lab, "check ids", "only in modules: %s; only in lab.json: %s" % (sorted(set(found) - set(all_ids)), sorted(set(all_ids) - set(found))))
    for number, m in enumerate(j["milestones"], 1):
        for cid in m["checkIds"]:
            if cid in found and found[cid] != number and (not through or number <= through):
                fail(lab, "check module", "%s is in m%02d but belongs to milestone %d" % (cid, found[cid], number))
    # 6. template files
    for name in ("Makefile", "README.md", "WRITEUP.md", ".gitignore"):
        if not os.path.isfile(os.path.join(tpl, name)):
            fail(lab, "template", name + " is missing")
    if os.path.isfile(os.path.join(tpl, "Makefile")) and not re.search(r"^check:", read(os.path.join(tpl, "Makefile")), re.M):
        fail(lab, "Makefile", "no check: target")
    if os.path.isfile(os.path.join(tpl, "WRITEUP.md")):
        heads = re.findall(r"^## (.+)$", read(os.path.join(tpl, "WRITEUP.md")), re.M)
        if heads != ["Problem", "Approach", "Results", "What I would change"]:
            fail(lab, "WRITEUP.md", "headings are %s" % heads)
    if os.path.isfile(os.path.join(tpl, ".gitignore")) and ".dojo/" not in read(os.path.join(tpl, ".gitignore")).split():
        fail(lab, ".gitignore", "must list .dojo/")
    for shared in ("report.py", "run_checks.py"):
        if not filecmp.cmp(os.path.join(tpl, "checks", shared), os.path.join(BASE, shared), shallow=False):
            fail(lab, "shared file", "checks/%s differs from b1-tokensim's" % shared)
    # 7. Make 3.81 portability
    for base in (tpl, ref):
        mk = os.path.join(base, "Makefile")
        if os.path.isfile(mk):
            text = read(mk)
            for bad in BANNED_MAKE:
                if bad in text:
                    fail(lab, "Makefile", "%s uses %s" % (os.path.relpath(mk, d), bad))
            for line in text.split("\n"):
                if line.startswith("    ") and not line.strip().startswith("#"):
                    fail(lab, "Makefile", "%s: a recipe line must start with a tab: %r" % (os.path.relpath(mk, d), line[:30]))
    # 8. standard library only
    own = {f[:-3] for base in (tpl, ref) for _, _, fs in os.walk(base) for f in fs if f.endswith(".py")}
    for base in (tpl, ref):
        for dp, _, fs in os.walk(base):
            for f in fs:
                if f.endswith(".py"):
                    for mod in re.findall(r"^\s*(?:import|from)\s+([A-Za-z_]\w*)", read(os.path.join(dp, f)), re.M):
                        if mod not in sys.stdlib_module_names and mod not in own:
                            fail(lab, "stdlib only", "%s imports %s" % (os.path.relpath(os.path.join(dp, f), d), mod))
    # 9. no finished solution left in the template
    for dp, _, fs in os.walk(tpl):
        for f in fs:
            rel = os.path.relpath(os.path.join(dp, f), tpl)
            other = os.path.join(ref, rel)
            if rel not in ("checks/report.py", "checks/run_checks.py", ".gitignore", "WRITEUP.md") and os.path.isfile(other) and filecmp.cmp(os.path.join(dp, f), other, shallow=False):
                fail(lab, "template leak", rel + " is identical to the reference file")


def run_checks(path, timeout):
    env = {k: v for k, v in os.environ.items() if k not in ("MAKEFLAGS", "MAKELEVEL", "MFLAGS")}
    began = time.time()
    try:
        subprocess.run(["make", "check"], cwd=path, env=env, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        return None, timeout
    took = time.time() - began
    try:
        return json.loads(read(os.path.join(path, ".dojo", "results.json")))["checks"], took
    except Exception:
        return None, took


def run(lab, through):
    d = os.path.join(LABS, lab)
    j = json.loads(read(os.path.join(d, "lab.json")))
    ids = [c for m in (j["milestones"][:through] if through else j["milestones"]) for c in m["checkIds"]]
    limit = j["timeoutSec"]
    with tempfile.TemporaryDirectory() as tmp:
        shutil.copytree(os.path.join(d, "template"), tmp, dirs_exist_ok=True)
        rows, took = run_checks(tmp, limit)
        if rows is None:
            fail(lab, "template run", "no results.json within %ss" % limit)
        else:
            by = {r["id"]: r for r in rows}
            for cid in ids:
                if cid not in by or by[cid]["status"] == "pass":
                    fail(lab, "template run", "check %s %s" % (cid, "is missing" if cid not in by else "passes on the template"))
            print("%s template: %d checks, none passing, %.1fs" % (lab, len(rows), took))
        shutil.copytree(os.path.join(d, "reference"), tmp, dirs_exist_ok=True)
        rows, took = run_checks(tmp, limit)
        if rows is None:
            fail(lab, "reference run", "no results.json within %ss" % limit)
        else:
            by = {r["id"]: r for r in rows}
            for cid in ids:
                if cid not in by or by[cid]["status"] != "pass":
                    fail(lab, "reference run", "check %s: %s" % (cid, by.get(cid, {}).get("detail", "missing")))
            if took > limit / 3:
                fail(lab, "reference run", "took %.1fs, more than timeoutSec / 3 (%.0fs)" % (took, limit / 3))
            print("%s reference: %d checks, %d passing, %.1fs (limit %ss)" % (lab, len(rows), sum(r["status"] == "pass" for r in rows), took, limit))


def main(argv):
    through = int(argv[argv.index("--through") + 1]) if "--through" in argv else 0
    args = [a for a in argv if not a.startswith("--") and a != str(through)]
    labs = sorted(os.listdir(LABS)) if "--all" in argv else args
    if not labs:
        print(__doc__)
        return 2
    for lab in labs:
        static(lab, through)
        if "--run" in argv and not any(f.startswith("FAIL %s:" % lab) for f in failures):
            run(lab, through)
    for f in failures:
        print(f)
    print("%d problem(s)" % len(failures) if failures else "ok: " + ", ".join(labs))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

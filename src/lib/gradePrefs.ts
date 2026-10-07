// The Repo folder a grade request reads (UAT cu-5 P2-3), remembered on this Mac across artifacts and sessions. A preference,
// not data: it lives in the browser's own storage and never in the database. G6: its default is the learner's project repo.

const KEY = 'dojo:grade-repo-folder'

/** The remembered folder, or null when none was chosen (the caller then starts from the project repo). An empty string is a choice too. */
export function readRepoFolder(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

export function writeRepoFolder(folder: string): void {
  try { localStorage.setItem(KEY, folder) } catch { /* private window or blocked storage: the field just starts from the default next time */ }
}

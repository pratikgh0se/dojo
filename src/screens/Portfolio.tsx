import { usePortfolioData } from '../data/portfolioHooks'
import { isReadOnly } from '../data/writer'
import { isProven } from '../rules/lab'
import { Loading } from '../ui/Loading'
import { LabCard } from './portfolio/LabCard'
import './portfolio.css'

export const PORTFOLIO_EMPTY = 'Labs you build and get reviewed will appear here.'

/**
 * The Portfolio destination (PORT-01 to PORT-19): one card per Proven lab (ascending lab id), each with four outputs. Reading writes
 * nothing; every write is a button or the text area. A lab is Proven when its newest review passed (`isProven`).
 */
export function Portfolio() {
  const data = usePortfolioData()
  const readOnly = isReadOnly()
  const proven = data
    ? data.labs.filter(l => isProven(data.reviews.filter(r => r.labId === l.labId))).sort((a, b) => (a.labId < b.labId ? -1 : a.labId > b.labId ? 1 : 0))
    : []
  // the Pages reminder is for the first site or article publish only
  const pagesPublished = !!data?.items.some(i => (i.kind === 'site' || i.kind === 'article') && i.status === 'published')
  return (
    <div className="content-screen pf">
      <h1 className="screen-title" data-testid="portfolio-title">Portfolio</h1>
      {!data ? <Loading /> : proven.length === 0 ? (
        <div className="sr-panel pf-empty" data-testid="portfolio-empty" data-empty="true"><p>{PORTFOLIO_EMPTY}</p></div>
      ) : proven.map(lab => (
        <LabCard key={lab.labId} lab={lab} items={data.items.filter(i => i.labId === lab.labId)} pagesPublished={pagesPublished} readOnly={readOnly} />
      ))}
    </div>
  )
}

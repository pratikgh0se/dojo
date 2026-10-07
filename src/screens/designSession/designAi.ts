import { clipTranscript } from '../../ai/prompts'
import type { AiTicket, DiagramJson, InterviewFinal, TranscriptMessage } from '../../ai/types'
import { callJob } from '../../data/aiActions'
import type { DojoDB } from '../../data/db'
import { now } from '../../lib/clock'
import type { PlanDesignRef } from '../../rules/designs'
import { INTERVIEW_ANSWERS } from '../../rules/designSession'

/** The only file in chain D that calls the AI (C-DESIGN §7 jobs `interview` and `diagram`), via callJob (aiLog). */
export type AiOutcome<T> = { ok: true; value: T } | { ok: false; error: string }

/**
 * UAT cu-7 P2-1: the validator's own wording ("score must be 0-20; perItem must be a list…") is for the helper's log, not
 * for the learner. A reply that stayed unusable after the repair and the helper's one re-ask reads as a plain sentence that
 * says what is lost (nothing) and what to do. Every other failure keeps its raw error (AI.md "UI contract": raw error + Retry).
 */
export const INVALID_REPLY = {
  turn: "The interviewer's reply did not come through in a form Dojo can use. Nothing is lost: Retry asks again.",
  closing: "The interviewer's closing line did not come through. Your interview is complete, so you can go on: End drawing when you are ready, or Retry.",
  grade: 'The interview grade did not come through in a form Dojo can read. Retry asks again, or score the session yourself below.',
  diagram: 'The reference diagram did not come through in a form Dojo can draw. Retry asks again.',
} as const
const friendly = (code: string, raw: string, plain: string) => (code === 'invalid_output' ? plain : raw)

export function designTicket(item: PlanDesignRef): AiTicket {
  return { id: item.id, title: item.title, track: 'design', difficulty: item.difficulty, links: item.refs }
}

/** I2: `transcript` alone carries the conversation (already clipped per message by clipTranscript);
 * sending the raw, unbounded `answers` alongside it could push the body over the helper's
 * MAX_BODY_BYTES and fail with 413 on every turn. jobPrompt only reads `answers` when there is no
 * transcript, so it is safe to omit once one exists. */
function interviewContext(item: PlanDesignRef, messages: readonly TranscriptMessage[], final: boolean) {
  const transcript = clipTranscript(messages)
  const turn = messages.filter(m => m.from === 'you').length
  // `answers` only matters to jobPrompt when there is no transcript, and transcript is empty exactly
  // when messages is (so the real answers would be [] anyway) - always [] here, never the raw text.
  return { turn, answers: [] as string[], deepDives: item.deepDives, transcript, ...(final ? { final: true } : {}) }
}

export async function askInterviewer(d: DojoDB, item: PlanDesignRef, messages: readonly TranscriptMessage[]): Promise<AiOutcome<string>> {
  const r = await callJob(d, 'interview', { ticket: designTicket(item), context: interviewContext(item, messages, false) }, now())
  const plain = messages.filter(m => m.from === 'you').length >= INTERVIEW_ANSWERS ? INVALID_REPLY.closing : INVALID_REPLY.turn
  if (!r.ok) return { ok: false, error: friendly(r.code, r.error, plain) }
  const say = (r.output as { say?: unknown }).say
  return typeof say === 'string' && say.trim() ? { ok: true, value: say } : { ok: false, error: plain }
}

export async function gradeInterview(d: DojoDB, item: PlanDesignRef, messages: readonly TranscriptMessage[]): Promise<AiOutcome<InterviewFinal>> {
  const r = await callJob(d, 'interview', { ticket: designTicket(item), context: interviewContext(item, messages, true) }, now())
  if (!r.ok) return { ok: false, error: friendly(r.code, r.error, INVALID_REPLY.grade) }
  const out = r.output as InterviewFinal
  return out && (out as { done?: unknown }).done === true ? { ok: true, value: out } : { ok: false, error: INVALID_REPLY.grade }
}

export async function drawReference(d: DojoDB, item: PlanDesignRef): Promise<AiOutcome<DiagramJson>> {
  const r = await callJob(d, 'diagram', { ticket: designTicket(item), context: { deepDives: item.deepDives, refs: item.refs } }, now())
  return r.ok ? { ok: true, value: r.output as DiagramJson } : { ok: false, error: friendly(r.code, r.error, INVALID_REPLY.diagram) }
}

const inflight = new Map<string, Promise<unknown>>()

/** One in-flight call per key: React StrictMode runs effects twice in dev, and a double click must not ask twice. */
export function once<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = inflight.get(key)
  if (hit) return hit as Promise<T>
  const p = fn().finally(() => inflight.delete(key))
  inflight.set(key, p)
  return p
}

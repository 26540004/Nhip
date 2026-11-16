/**
 * Block lifecycle writes (online only — they lead to Google Calendar changes):
 * approve a proposal, undo it, move a block, drop a block. After each write the app asks
 * gcal-sync to push the change to Google (when connected).
 */
import { requireSupabase, unwrap } from './supabase';

export interface Decision {
  id: string;
  accept: boolean;
  start_at?: string;
  end_at?: string;
}

export async function applyProposal(proposalId: string, decisions: Decision[], replaces: string[]): Promise<{ accepted: string[] }> {
  const db = requireSupabase();
  const accepted = decisions.filter((d) => d.accept);
  const rejected = decisions.filter((d) => !d.accept).map((d) => d.id);
  for (const d of accepted) {
    unwrap(
      await db
        .from('task_blocks')
        .update({ status: 'accepted', ...(d.start_at ? { start_at: d.start_at, end_at: d.end_at } : {}) })
        .eq('id', d.id)
        .eq('status', 'proposed')
        .select('id'),
    );
  }
  if (rejected.length) unwrap(await db.from('task_blocks').update({ status: 'rejected' }).in('id', rejected).select('id'));
  // "Cân bằng lại": the old blocks of the overloaded day are replaced only if something was accepted.
  if (replaces.length && accepted.length)
    unwrap(await db.from('task_blocks').update({ status: 'rejected' }).in('id', replaces).select('id'));
  unwrap(await db.from('ai_proposals').update({ status: 'applied' }).eq('id', proposalId).select('id'));
  return { accepted: accepted.map((d) => d.id) };
}

/** Undo within 10 s: remove the new blocks (their Google events get deleted on sync), restore replaced ones. */
export async function undoApply(proposalId: string, acceptedIds: string[], replaces: string[]): Promise<void> {
  const db = requireSupabase();
  if (acceptedIds.length) unwrap(await db.from('task_blocks').update({ status: 'rejected' }).in('id', acceptedIds).select('id'));
  if (replaces.length) unwrap(await db.from('task_blocks').update({ status: 'accepted' }).in('id', replaces).select('id'));
  unwrap(await db.from('ai_proposals').update({ status: 'reviewed' }).eq('id', proposalId).select('id'));
}

export async function moveBlock(id: string, startIso: string, endIso: string): Promise<void> {
  // 'accepted' = "needs push": gcal-sync patches the existing event (or inserts if none).
  unwrap(
    await requireSupabase()
      .from('task_blocks')
      .update({ start_at: startIso, end_at: endIso, status: 'accepted' })
      .eq('id', id)
      .select('id'),
  );
}

export async function dropBlock(id: string): Promise<void> {
  unwrap(await requireSupabase().from('task_blocks').update({ status: 'rejected' }).eq('id', id).select('id'));
}

export async function markProposalReviewed(proposalId: string): Promise<void> {
  unwrap(await requireSupabase().from('ai_proposals').update({ status: 'reviewed' }).eq('id', proposalId).select('id'));
}

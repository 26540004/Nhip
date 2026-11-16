import { router } from 'expo-router';
import { useState } from 'react';
import { errorMessage } from '../../components/QueryState';
import { showToast } from '../../components/Toast';
import { proposePlan } from '../../lib/api/functions';

/** Ask propose-plan for a proposal, then open the review screen. */
export function useStartPlan() {
  const [busy, setBusy] = useState(false);
  const start = async (body: Parameters<typeof proposePlan>[0]) => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await proposePlan(body);
      router.push({ pathname: '/plan', params: { id: res.proposal_id } });
    } catch (e) {
      showToast(errorMessage(e), { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };
  return { start, busy };
}

import { useLocalSearchParams } from 'expo-router';
import { PlanReviewScreen } from '../src/features/plan/PlanReviewScreen';

export default function PlanRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <PlanReviewScreen proposalId={id} />;
}

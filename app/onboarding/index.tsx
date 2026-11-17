import { Redirect } from 'expo-router';

/** /onboarding → first onboarding step. */
export default function OnboardingIndex() {
  return <Redirect href={{ pathname: '/onboarding/[step]', params: { step: 'google' } }} />;
}

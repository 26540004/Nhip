import { Redirect } from 'expo-router';

/** OAuth return URL (nhip://auth/callback). The session is completed in signIn.ts; just go home. */
export default function AuthCallback() {
  return <Redirect href="/" />;
}

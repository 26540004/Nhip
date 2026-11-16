import { Redirect } from 'expo-router';

/** Unknown paths (old links, the page opened at /index.html, …) go to Today. */
export default function NotFound() {
  return <Redirect href="/" />;
}

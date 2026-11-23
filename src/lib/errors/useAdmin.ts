import { useQuery } from '@tanstack/react-query';
import { usePathname } from 'expo-router';
import { useEffect } from 'react';
import { requireSupabase } from '../api/supabase';
import { installGlobalHandlers, loadAutoReport, setReporterAdmin, setReporterRoute } from './reporter';

/** Is the signed-in user the app's admin (public.app_admins)? Decided by the server. */
export function useIsAdmin(enabled = true) {
  return useQuery({
    queryKey: ['is-admin'],
    enabled,
    staleTime: 60 * 60_000,
    queryFn: async () => {
      const { data, error } = await requireSupabase().rpc('is_admin');
      if (error) return false;
      return data === true;
    },
  });
}

/** Turns error reporting on for the admin only; keeps the current screen for reports. */
export function useAdminReporter(signedIn: boolean) {
  const isAdmin = useIsAdmin(signedIn).data === true && signedIn;
  const pathname = usePathname();
  useEffect(() => {
    setReporterAdmin(isAdmin);
    if (isAdmin) {
      void loadAutoReport();
      installGlobalHandlers();
    }
  }, [isAdmin]);
  useEffect(() => setReporterRoute(pathname), [pathname]);
  return isAdmin;
}

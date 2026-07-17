import { useAuth } from '@org/data';

export interface SuperAdminGuardState {
  user: ReturnType<typeof useAuth>['user'];
  session: ReturnType<typeof useAuth>['session'];
  loading: boolean;
  isSuperAdmin: boolean;
}

export function useSuperAdminGuard(): SuperAdminGuardState {
  const { user, session, loading } = useAuth();
  return {
    user,
    session,
    loading,
    isSuperAdmin: user?.app_metadata?.['role'] === 'super_admin',
  };
}

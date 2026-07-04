import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useSuperAdminGuard } from '../hooks/useSuperAdminGuard';

interface Props {
  children: ReactNode;
}

export function ProtectedRoute({ children }: Props) {
  const { user, loading, isSuperAdmin } = useSuperAdminGuard();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <span className="spinner spinner-dark" style={{ width: 28, height: 28, borderWidth: 3 }} />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" state={{ from: location }} replace />;
  }

  if (!isSuperAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="card text-center" style={{ padding: 48, maxWidth: 400 }}>
          <div className="text-[2rem] mb-3"><i className="fa-solid fa-lock" aria-hidden="true" /></div>
          <h2 className="text-[#0B2A4A]">Access Denied</h2>
          <p className="text-[#64748b]">You don't have super admin access.</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

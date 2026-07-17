import { createBrowserRouter, Navigate } from 'react-router-dom';
import { AuthPage } from '../pages/auth/AuthPage';
import { DashboardPage } from '../pages/dashboard/DashboardPage';
import { CompaniesPage } from '../pages/companies/CompaniesPage';
import { WaitlistPage } from '../pages/waitlist/WaitlistPage';
import { AppLayout } from '../components/layout/Layout';
import { ProtectedRoute } from './ProtectedRoute';

export const router = createBrowserRouter([
  { path: '/auth', element: <AuthPage /> },
  {
    element: <ProtectedRoute><AppLayout /></ProtectedRoute>,
    children: [
      { path: '/dashboard', element: <DashboardPage /> },
      { path: '/companies', element: <CompaniesPage /> },
      { path: '/waitlist', element: <WaitlistPage /> },
      { path: '/', element: <Navigate to="/dashboard" replace /> },
    ],
  },
  { path: '*', element: <Navigate to="/dashboard" replace /> },
]);

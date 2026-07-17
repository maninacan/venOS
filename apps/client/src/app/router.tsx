import { createBrowserRouter, Navigate } from 'react-router-dom';
import { AuthPage } from '../pages/auth/AuthPage';
import { CompaniesPage } from '../pages/companies/CompaniesPage';
import { CreateCompanyPage } from '../pages/companies/CreateCompanyPage';
import { EventsPage } from '../pages/events/EventsPage';
import { EventDashboardPage } from '../pages/events/EventDashboardPage';
import { AddEventPage } from '../pages/events/AddEventPage';
import { PostEventReportPage } from '../pages/events/PostEventReportPage';
import { InventoryPage } from '../pages/inventory/InventoryPage';
import { RecipesPage } from '../pages/recipes/RecipesPage';
import { RestockPage } from '../pages/restock/RestockPage';
import { SettingsPage } from '../pages/settings/SettingsPage';
import { BillingPage } from '../pages/billing/BillingPage';
import { ProfilePage } from '../pages/profile/ProfilePage';
import { HomePage } from '../pages/home/HomePage';
import { CompanyLayout, RootLayout } from '../components/layout/Layout';
import { ProtectedRoute } from './ProtectedRoute';
import { ErrorElement } from '../components/layout/ErrorElement';

export const router = createBrowserRouter([
  // Public
  { path: '/auth', element: <AuthPage /> },

  // Authenticated root (no company)
  {
    element: <ProtectedRoute><RootLayout /></ProtectedRoute>,
    errorElement: <ErrorElement />,
    children: [
      { path: '/companies', element: <CompaniesPage /> },
      { path: '/companies/new', element: <CreateCompanyPage /> },
      { path: '/profile', element: <ProfilePage /> },
    ],
  },

  // Authenticated + company-scoped
  {
    path: '/companies/:companyId',
    element: <ProtectedRoute><CompanyLayout /></ProtectedRoute>,
    errorElement: <ErrorElement />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'events', element: <EventsPage /> },
      { path: 'events/new', element: <AddEventPage /> },
      { path: 'events/:eventId', element: <EventDashboardPage />, errorElement: <ErrorElement /> },
      { path: 'events/:eventId/edit', element: <AddEventPage /> },
      { path: 'events/:eventId/report', element: <PostEventReportPage />, errorElement: <ErrorElement /> },
      { path: 'inventory', element: <InventoryPage /> },
      { path: 'recipes', element: <RecipesPage /> },
      { path: 'restock', element: <RestockPage /> },
      { path: 'settings', element: <SettingsPage />, errorElement: <ErrorElement /> },
      { path: 'billing', element: <BillingPage />, errorElement: <ErrorElement /> },
    ],
  },

  // Default redirect
  { path: '/', element: <Navigate to="/companies" replace /> },
  { path: '*', element: <Navigate to="/companies" replace /> },
]);

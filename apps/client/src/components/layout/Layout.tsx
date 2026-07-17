import { Outlet } from 'react-router-dom';
import { Header } from './Header';
import { useCurrentCompany } from '../../hooks/useCurrentCompany';
export function CompanyLayout() {
  const { companyId, company } = useCurrentCompany();

  return (
    <div className="min-h-screen flex flex-col">
      <Header companyId={companyId ?? undefined} companyName={company?.name} />
      <main className="flex-1 max-w-[1100px] w-full mx-auto px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}

export function RootLayout() {
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 max-w-[1100px] w-full mx-auto px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}

import { NavLink } from 'react-router-dom';

const navItems = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/companies', label: 'Companies' },
  { to: '/waitlist', label: 'Waitlist' },
];

const linkBase = 'block px-[14px] py-[9px] rounded-lg text-[0.88rem] font-medium text-[#64748b] no-underline transition-colors hover:bg-[#f1f5f9] hover:text-[#0B2A4A]';
const linkActive = 'bg-[#eff6ff] text-[#0B2A4A] font-semibold';

export function Sidebar() {
  return (
    <aside className="w-[220px] flex-shrink-0 bg-white border-r border-[rgba(11,42,74,0.12)] flex flex-col">
      <nav className="flex flex-col gap-0.5 p-4 pt-4 px-2.5">
        {navItems.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) => `${linkBase}${isActive ? ` ${linkActive}` : ''}`}
          >
            {item.label}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}

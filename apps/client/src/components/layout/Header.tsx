import { useState, useEffect, useRef } from 'react';
import { NavLink, Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { supabase, showToast, useAuth } from '@org/data';
import { AlertsBell } from './AlertsBell';
import venviewLogo from '../../assets/venOS-logo.jpg';

interface Props {
  companyId?: string;
  companyName?: string;
}

const linkBase =
  'bg-transparent border-0 text-[#222] text-[0.87rem] font-medium rounded-md cursor-pointer transition-colors no-underline inline-flex items-center gap-2 font-[inherit] hover:text-[#0B2A4A] hover:bg-[rgba(11,42,74,0.06)] px-3 py-2 w-full md:w-auto md:px-[10px] md:py-[7px]';
const linkActive = 'text-[#0B2A4A] bg-[rgba(11,42,74,0.06)] font-semibold';

const menuItem =
  'flex items-center gap-2.5 w-full text-left bg-transparent border-0 text-[#222] text-[0.87rem] font-medium rounded-md cursor-pointer no-underline font-[inherit] px-3 py-2 hover:bg-[rgba(11,42,74,0.06)] hover:text-[#0B2A4A]';
const menuItemActive = 'bg-[rgba(11,42,74,0.06)] text-[#0B2A4A] font-semibold';

function avatarInitials(name: string, email: string): string {
  const n = name.trim();
  if (n) {
    const parts = n.split(/\s+/);
    return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase();
  }
  return (email.trim()[0] ?? '?').toUpperCase();
}

export function Header({ companyId, companyName }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [avatarOpen, setAvatarOpen] = useState(false);
  const avatarRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { user } = useAuth();
  const { t } = useTranslation('nav');

  async function handleLogout() {
    await supabase.auth.signOut();
    navigate('/auth');
    showToast(t('toast.signedOut', 'Signed out.'), 'info');
  }

  function closeMenu() { setMenuOpen(false); }
  function closeAvatar() { setAvatarOpen(false); }
  const inCompany = !!companyId;

  const displayName = (user?.user_metadata?.['name'] as string)
    ?? (user?.user_metadata?.['full_name'] as string)
    ?? '';
  const email = user?.email ?? '';
  const initials = avatarInitials(displayName, email);

  // Close the avatar dropdown on outside click.
  useEffect(() => {
    if (!avatarOpen) return;
    function onDown(e: MouseEvent) {
      if (avatarRef.current && !avatarRef.current.contains(e.target as Node)) setAvatarOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [avatarOpen]);

  return (
    <header className="bg-white text-[#222] px-5 h-[70px] flex items-center justify-between sticky top-0 z-[100] shadow-[0_2px_6px_rgba(0,0,0,0.08)] border-b border-[#dde3f0]">
      <Link
        to={inCompany ? `/companies/${companyId}/events` : '/companies'}
        className="flex items-center gap-2.5 no-underline flex-shrink-0"
        onClick={closeMenu}
      >
        <img src={venviewLogo} alt={t('logoAlt', 'venOS')} className="h-[50px] w-auto" />
        <div>
          <span
            className="block text-[1.05rem] leading-tight font-bold"
            style={{ color: '#2E7D32' }}
          >
            {t('brand.name', 'venOS Events')}
          </span>
          <span className="block text-[0.68rem] text-[#666]">
            {companyName ?? t('brand.tagline', 'Vendor Intelligence for Events')}
          </span>
        </div>
      </Link>

      <div className="flex items-center gap-0.5">
        {/* Hamburger — mobile only */}
        <button
          className="flex flex-col justify-between w-[22px] h-4 bg-transparent border-0 cursor-pointer p-0 md:hidden"
          onClick={() => setMenuOpen(o => !o)}
          aria-label={t('menu.toggle', 'Menu')}
        >
          <span className="block w-full h-0.5 bg-[#222] rounded-sm" />
          <span className="block w-full h-0.5 bg-[#222] rounded-sm" />
          <span className="block w-full h-0.5 bg-[#222] rounded-sm" />
        </button>

        {/* Nav links */}
        <div
          className={`${menuOpen ? 'flex' : 'hidden'} fixed top-[70px] left-0 right-0 z-[99] flex-col bg-white p-2.5 gap-0.5 shadow-[0_8px_24px_rgba(0,0,0,0.12)] border-t border-[#dde3f0] md:flex md:static md:flex-row md:bg-transparent md:p-0 md:gap-0.5 md:shadow-none md:z-auto md:border-0`}
        >
          {!inCompany && (
            <NavLink to="/companies" end className={({ isActive }) => `${linkBase}${isActive ? ` ${linkActive}` : ''}`} onClick={closeMenu}><i className="fa-solid fa-building w-4 text-center" /> {t('menu.myCompanies', 'My Companies')}</NavLink>
          )}

          {inCompany && (
            <>
              <Link to="/companies" className={linkBase} onClick={closeMenu}><i className="fa-solid fa-arrow-left w-4 text-center" /> {t('menu.companies', 'Companies')}</Link>
              <NavLink to={`/companies/${companyId}`} end className={({ isActive }) => `${linkBase}${isActive ? ` ${linkActive}` : ''}`} onClick={closeMenu}><i className="fa-solid fa-house w-4 text-center" /> {t('menu.home', 'Home')}</NavLink>
              <NavLink to={`/companies/${companyId}/events`} className={({ isActive }) => `${linkBase}${isActive ? ` ${linkActive}` : ''}`} onClick={closeMenu}><i className="fa-solid fa-calendar-days w-4 text-center" /> {t('menu.events', 'Events')}</NavLink>
              <NavLink to={`/companies/${companyId}/recipes`} className={({ isActive }) => `${linkBase}${isActive ? ` ${linkActive}` : ''}`} onClick={closeMenu}><i className="fa-solid fa-utensils w-4 text-center" /> {t('menu.recipes', 'Recipes')}</NavLink>
              <NavLink to={`/companies/${companyId}/inventory`} className={({ isActive }) => `${linkBase}${isActive ? ` ${linkActive}` : ''}`} onClick={closeMenu}><i className="fa-solid fa-boxes-stacked w-4 text-center" /> {t('menu.myInventory', 'My Inventory')}</NavLink>
              <NavLink to={`/companies/${companyId}/restock`} className={({ isActive }) => `${linkBase}${isActive ? ` ${linkActive}` : ''}`} onClick={closeMenu}><i className="fa-solid fa-arrows-rotate w-4 text-center" /> {t('menu.restock', 'Restock')}</NavLink>
            </>
          )}

        </div>

        {inCompany && <AlertsBell companyId={companyId} />}

        {/* Avatar + account dropdown */}
        <div className="relative ml-1.5" ref={avatarRef}>
          <button
            className="w-9 h-9 rounded-full bg-[#0B2A4A] text-white text-[0.82rem] font-semibold flex items-center justify-center cursor-pointer border-0 hover:bg-[#0A3A67] transition-colors"
            onClick={() => setAvatarOpen(o => !o)}
            aria-label={t('account.menu', 'Account menu')}
            aria-haspopup="menu"
            aria-expanded={avatarOpen}
            title={email}
          >
            {initials}
          </button>

          {avatarOpen && (
            <div
              className="absolute right-0 top-[calc(100%+8px)] z-[101] min-w-[220px] bg-white rounded-xl p-1.5 shadow-[0_8px_24px_rgba(0,0,0,0.14)] border border-[#dde3f0]"
              role="menu"
            >
              <div className="px-3 pt-2 pb-2.5 border-b border-[#eef1f6] mb-1">
                {displayName && <div className="text-[0.85rem] font-semibold text-[#0B2A4A] truncate">{displayName}</div>}
                <div className="text-[0.78rem] text-[#64748b] truncate">{email}</div>
              </div>

              <NavLink to="/profile" className={({ isActive }) => `${menuItem}${isActive ? ` ${menuItemActive}` : ''}`} role="menuitem" onClick={closeAvatar}>
                <i className="fa-solid fa-user w-4 text-center text-[#64748b]" /> {t('account.profile', 'Profile')}
              </NavLink>
              {inCompany && (
                <>
                  <NavLink to={`/companies/${companyId}/billing`} className={({ isActive }) => `${menuItem}${isActive ? ` ${menuItemActive}` : ''}`} role="menuitem" onClick={closeAvatar}>
                    <i className="fa-solid fa-credit-card w-4 text-center text-[#64748b]" /> {t('account.billing', 'Billing')}
                  </NavLink>
                  <NavLink to={`/companies/${companyId}/settings`} className={({ isActive }) => `${menuItem}${isActive ? ` ${menuItemActive}` : ''}`} role="menuitem" onClick={closeAvatar}>
                    <i className="fa-solid fa-gear w-4 text-center text-[#64748b]" /> {t('account.settings', 'Settings')}
                  </NavLink>
                </>
              )}

              <div className="border-t border-[#eef1f6] my-1" />
              <button className={menuItem} role="menuitem" onClick={() => { closeAvatar(); handleLogout(); }}>
                <i className="fa-solid fa-right-from-bracket w-4 text-center text-[#64748b]" /> {t('account.logout', 'Logout')}
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

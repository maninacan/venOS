import { Link, useNavigate } from 'react-router-dom';
import { supabase, showToast } from '@org/data';

export function Header() {
  const navigate = useNavigate();

  async function handleLogout() {
    await supabase.auth.signOut();
    navigate('/auth');
    showToast('Signed out.', 'info');
  }

  return (
    <header className="bg-[#0B2A4A] text-white px-5 h-[60px] flex items-center justify-between sticky top-0 z-[100] shadow-[0_2px_8px_rgba(11,42,74,0.3)]">
      <Link to="/" className="flex items-center gap-2.5 no-underline">
        <span
          className="block text-[1.05rem] text-white leading-tight"
          style={{ fontFamily: "'DM Serif Display', serif" }}
        >
          venOS Super Admin
        </span>
      </Link>
      <div className="flex items-center gap-0.5">
        <button
          className="bg-transparent border-0 text-[rgba(255,255,255,0.82)] text-[0.87rem] font-medium px-[11px] py-[7px] rounded-md cursor-pointer font-[inherit] transition-colors hover:text-white hover:bg-[rgba(255,255,255,0.12)]"
          onClick={handleLogout}
        >
          Logout
        </button>
      </div>
    </header>
  );
}

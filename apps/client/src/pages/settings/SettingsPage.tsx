import { useState, useEffect } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import { useSearchParams, useNavigate, useLocation } from 'react-router-dom';
import { useQuery, useMutation } from '@apollo/client/react';
import { gql } from '@apollo/client/core';
import { useCurrentCompany } from '../../hooks/useCurrentCompany';
import { BackToSetupButton } from '../../components/guidance/BackToSetupButton';
import { showToast, useAuth } from '@org/data';
import { PosMappingModal } from '../../components/modals/PosMappingModal';
import { LanguageRegionCard } from '../../components/settings/LanguageRegionCard';

const GET_SETTINGS = gql`
  query GetSettings($companyId: ID!) {
    company(id: $companyId) {
      id name phone contactName vendorCategory email joinCode plan pendingOwnerId taxjarConnected posSystem
      members { userId email role }
      pendingRequests { userId email role }
      posStatus { connected provider locationName locationId needsReauth }
    }
  }
`;
const UPDATE_COMPANY = gql`
  mutation UpdateCompany($id: ID!, $input: UpdateCompanyInput!) {
    updateCompany(id: $id, input: $input) { id name phone contactName vendorCategory email }
  }
`;
const REMOVE_MEMBER = gql`
  mutation RemoveMember($companyId: ID!, $userId: ID!) {
    removeMember(companyId: $companyId, userId: $userId)
  }
`;
const LEAVE = gql`
  mutation LeaveCompany($companyId: ID!) {
    leaveCompany(companyId: $companyId)
  }
`;
const APPROVE_MEMBER = gql`
  mutation ApproveMember($companyId: ID!, $userId: ID!) {
    approveMember(companyId: $companyId, userId: $userId)
  }
`;
const INVITE_MEMBER = gql`
  mutation InviteMember($companyId: ID!, $email: String!) {
    inviteMember(companyId: $companyId, email: $email) { email status }
  }
`;
const SET_TAXJAR = gql`
  mutation SetTaxjarToken($companyId: ID!, $token: String!) {
    setTaxjarToken(companyId: $companyId, token: $token)
  }
`;
const REMOVE_TAXJAR = gql`
  mutation RemoveTaxjarToken($companyId: ID!) {
    removeTaxjarToken(companyId: $companyId)
  }
`;
const OFFER_OWNERSHIP = gql`
  mutation OfferOwnership($companyId: ID!, $newOwnerId: ID!) {
    offerOwnership(companyId: $companyId, newOwnerId: $newOwnerId)
  }
`;
const ACCEPT_OWNERSHIP = gql`
  mutation AcceptOwnership($companyId: ID!) {
    acceptOwnership(companyId: $companyId)
  }
`;
const DECLINE_OWNERSHIP = gql`
  mutation DeclineOwnership($companyId: ID!) {
    declineOwnership(companyId: $companyId)
  }
`;
const DELETE_COMPANY = gql`
  mutation DeleteCompany($id: ID!) {
    deleteCompany(id: $id)
  }
`;

const API_URL = (import.meta.env['VITE_API_URL'] as string) || 'http://localhost:3000';

// Client-side mirror of the server POS registry. `implemented` gates the
// connect flow; capabilities drive which actions appear. Keep in sync with
// apps/venview-api/src/lib/pos/index.ts.
interface PosMeta { displayName: string; blurb: string; implemented: boolean; }
const POS_META: Record<string, PosMeta> = {
  square: { displayName: 'Square', blurb: 'Sync sales, locations & labor automatically', implemented: true },
  shopify: { displayName: 'Shopify', blurb: 'Sync sales automatically', implemented: false },
  toast: { displayName: 'Toast', blurb: 'Sync sales & labor automatically', implemented: true },
};

export function SettingsPage() {
  const { t } = useTranslation('settings');
  const { companyId, company } = useCurrentCompany();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [updateCompany] = useMutation(UPDATE_COMPANY);
  const [removeMember] = useMutation(REMOVE_MEMBER);
  const [leaveCompany] = useMutation(LEAVE);
  const [approveMember] = useMutation(APPROVE_MEMBER);
  const [inviteMember] = useMutation(INVITE_MEMBER);
  const [offerOwnership] = useMutation(OFFER_OWNERSHIP);
  const [acceptOwnership] = useMutation(ACCEPT_OWNERSHIP);
  const [declineOwnership] = useMutation(DECLINE_OWNERSHIP);
  const [deleteCompany] = useMutation(DELETE_COMPANY);
  const [setTaxjarToken] = useMutation(SET_TAXJAR);
  const [removeTaxjarToken] = useMutation(REMOVE_TAXJAR);
  const { user } = useAuth();

  const { data, loading, refetch } = useQuery(GET_SETTINGS, {
    variables: { companyId },
    skip: !companyId,
  });

  const [showPosMappings, setShowPosMappings] = useState(false);
  const [companyForm, setCompanyForm] = useState({ name: '', phone: '', contactName: '', vendorCategory: '', email: '' });
  const [savingCompany, setSavingCompany] = useState(false);
  const [connectingPos, setConnectingPos] = useState(false);
  const [toastGuid, setToastGuid] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviting, setInviting] = useState(false);
  const [inviteCooldown, setInviteCooldown] = useState(0);
  const [transferTo, setTransferTo] = useState('');
  const [taxjarInput, setTaxjarInput] = useState('');
  const [savingTaxjar, setSavingTaxjar] = useState(false);

  const info = data?.company;
  const posStatus = info?.posStatus;
  // The company's chosen POS (falls back to Square for legacy companies).
  const provider = (posStatus?.provider ?? info?.posSystem ?? 'square') as string;
  const posMeta = POS_META[provider] ?? POS_META['square'];
  const members = info?.members ?? [];
  const pendingRequests = info?.pendingRequests ?? [];
  const isOwner = members.some((m: { userId: string; role: string }) => m.userId === user?.id && m.role === 'owner');

  // Tick down the invite cooldown.
  useEffect(() => {
    if (inviteCooldown <= 0) return;
    const t = setInterval(() => setInviteCooldown(c => Math.max(0, c - 1)), 1000);
    return () => clearInterval(t);
  }, [inviteCooldown > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  // Prefill company form
  useEffect(() => {
    if (!info) return;
    setCompanyForm({
      name: info.name ?? '',
      phone: info.phone ?? '',
      contactName: info.contactName ?? '',
      vendorCategory: info.vendorCategory ?? '',
      email: info.email ?? '',
    });
  }, [info]);

  // Scroll to an anchored section (e.g. #team-access) once content has rendered
  useEffect(() => {
    if (loading || !location.hash) return;
    const el = document.getElementById(location.hash.slice(1));
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [loading, location.hash]);

  // Handle post-OAuth redirect
  useEffect(() => {
    const pos = searchParams.get('pos');
    if (pos === 'connected') {
      showToast(t('toast.posConnected', '✅ POS connected successfully! Your locations are now available.'), 'success', 6000);
      setSearchParams({});
      refetch();
      // Launched from the getting-started checklist (the ?setup=1 marker is lost
      // across the OAuth round-trip, so it's stashed in sessionStorage) — return.
      if (sessionStorage.getItem('venview_setup_return') === '1') {
        sessionStorage.removeItem('venview_setup_return');
        navigate(`/companies/${companyId}`);
      }
    } else if (pos === 'error') {
      showToast(t('toast.posFailed', 'POS connection failed. Please try again.'), 'error');
      setSearchParams({});
    }
  }, [searchParams, setSearchParams, refetch, navigate, companyId, t]);

  async function handleConnectPos() {
    setConnectingPos(true);
    try {
      const { supabase } = await import('@org/data');
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      const res = await fetch(`${API_URL}/api/pos/${provider}/oauth/start?companyId=${companyId}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const result = await res.json() as { url?: string; error?: string };
      if (!result.url) throw new Error(result.error ?? t('toast.getOAuthUrlFailed', 'Failed to get OAuth URL'));
      // Remember to return to the setup checklist after the OAuth round-trip.
      if (searchParams.get('setup') === '1') sessionStorage.setItem('venview_setup_return', '1');
      window.location.href = result.url;
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('toast.connectFailed', 'Failed to connect {{name}}', { name: posMeta.displayName }), 'error');
      setConnectingPos(false);
    }
  }

  // Toast connects by entering a restaurant GUID (client-credentials model),
  // not a redirect OAuth flow like Square.
  async function handleConnectToast() {
    if (!toastGuid.trim()) return;
    setConnectingPos(true);
    try {
      const { supabase } = await import('@org/data');
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      const res = await fetch(`${API_URL}/api/pos/toast/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ companyId, restaurantGuid: toastGuid.trim() }),
      });
      const result = await res.json() as { success?: boolean; error?: string };
      if (!res.ok || !result.success) throw new Error(result.error ?? t('toast.toastConnectFailed', 'Failed to connect Toast'));
      showToast(t('toast.toastConnected', 'Toast connected.'), 'success');
      setToastGuid('');
      refetch();
      // Auto-return to the checklist if this step was launched from setup.
      if (searchParams.get('setup') === '1') navigate(`/companies/${companyId}`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('toast.toastConnectFailed', 'Failed to connect Toast'), 'error');
    } finally {
      setConnectingPos(false);
    }
  }

  async function handleDisconnectPos() {
    if (!confirm(t('toast.confirmDisconnectPos', 'Disconnect {{name}}? You will need to reconnect to sync sales.', { name: posMeta.displayName }))) return;
    try {
      const { supabase } = await import('@org/data');
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      const res = await fetch(`${API_URL}/api/pos/${provider}/disconnect/${companyId}`, {
        method: 'DELETE',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(t('toast.disconnectRequestFailed', 'Disconnect failed'));
      showToast(t('toast.posDisconnected', '{{name}} disconnected.', { name: posMeta.displayName }), 'info');
      refetch();
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('toast.disconnectFailed', 'Failed to disconnect'), 'error');
    }
  }

  async function handleSaveTaxjar() {
    if (!taxjarInput.trim()) return;
    setSavingTaxjar(true);
    try {
      await setTaxjarToken({ variables: { companyId, token: taxjarInput.trim() } });
      showToast(t('toast.taxjarConnected', 'TaxJar connected.'), 'success');
      setTaxjarInput('');
      refetch();
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('toast.taxjarSaveFailed', 'Failed to save token'), 'error');
    } finally { setSavingTaxjar(false); }
  }

  async function handleRemoveTaxjar() {
    if (!confirm(t('toast.confirmRemoveTaxjar', 'Disconnect TaxJar? Tax rates will no longer auto-look-up.'))) return;
    try {
      await removeTaxjarToken({ variables: { companyId } });
      showToast(t('toast.taxjarDisconnected', 'TaxJar disconnected.'), 'info');
      refetch();
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('toast.disconnectFailed', 'Failed to disconnect'), 'error');
    }
  }

  async function saveCompanyDetails() {
    setSavingCompany(true);
    try {
      await updateCompany({ variables: { id: companyId, input: companyForm } });
      showToast(t('toast.detailsSaved', 'Company details saved!'), 'success');
      refetch();
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('toast.saveFailed', 'Failed to save'), 'error');
    } finally { setSavingCompany(false); }
  }

  async function handleRemoveMember(userId: string, email: string) {
    if (!confirm(t('toast.confirmRemoveMember', 'Remove {{email}} from the team?', { email }))) return;
    try {
      await removeMember({ variables: { companyId, userId } });
      showToast(t('toast.memberRemoved', 'Member removed.'), 'success');
      refetch();
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('toast.removeMemberFailed', 'Failed to remove member'), 'error');
    }
  }

  async function handleInvite() {
    const email = inviteEmail.trim();
    if (!email || inviteCooldown > 0) return;
    setInviting(true);
    try {
      const { data: result } = await inviteMember({ variables: { companyId, email } });
      const { email: invitedEmail, status } = result.inviteMember;
      if (status === 'invited') {
        showToast(t('toast.inviteSent', 'Invitation email sent to {{email}}.', { email: invitedEmail }), 'success', 6000);
        // New-user invites send an email — brief cooldown to avoid tripping the rate limit.
        setInviteCooldown(30);
      } else if (status === 'added') {
        showToast(t('toast.memberAdded', '{{email}} added to the team.', { email: invitedEmail }), 'success');
      } else {
        showToast(t('toast.alreadyMember', '{{email}} is already a member.', { email: invitedEmail }), 'info');
      }
      setInviteEmail('');
      refetch();
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      const match = msg.match(/after (\d+) seconds/i);
      if (match || /security purposes|rate limit|too many requests/i.test(msg)) {
        const secs = match ? parseInt(match[1], 10) : 30;
        setInviteCooldown(secs);
        showToast(t('toast.inviteRateLimit', 'Please wait {{count}}s before sending another invite — email sending is rate-limited.', { count: secs }), 'warning', 6000);
      } else {
        showToast(msg || t('toast.inviteFailed', 'Failed to invite member'), 'error');
      }
    } finally { setInviting(false); }
  }

  async function handleApprove(userId: string, email: string) {
    try {
      await approveMember({ variables: { companyId, userId } });
      showToast(t('toast.memberApproved', '{{email}} approved.', { email }), 'success');
      refetch();
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('toast.approveFailed', 'Failed to approve request'), 'error');
    }
  }

  async function handleDeny(userId: string, email: string) {
    if (!confirm(t('toast.confirmDeny', "Deny {{email}}'s access request?", { email }))) return;
    try {
      await removeMember({ variables: { companyId, userId } });
      showToast(t('toast.requestDenied', 'Request denied.'), 'info');
      refetch();
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('toast.denyFailed', 'Failed to deny request'), 'error');
    }
  }

  async function handleLeave() {
    if (!confirm(t('toast.confirmLeave', "Leave {{name}}? You'll lose access until you're invited again.", { name: info?.name ?? t('danger.thisCompany', 'this company') }))) return;
    try {
      await leaveCompany({ variables: { companyId } });
      showToast(t('toast.leftCompany', 'You left the company.'), 'info');
      navigate('/companies');
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('toast.leaveFailed', 'Failed to leave company'), 'error');
    }
  }

  async function handleOffer() {
    if (!transferTo) return;
    const target = members.find((m: { userId: string; email: string }) => m.userId === transferTo);
    if (!confirm(t('toast.confirmOffer', 'Offer ownership of {{name}} to {{email}}? It only takes effect once they accept.', { name: info?.name ?? t('danger.thisCompany', 'this company'), email: target?.email }))) return;
    try {
      await offerOwnership({ variables: { companyId, newOwnerId: transferTo } });
      showToast(t('toast.ownershipOffered', 'Ownership offered to {{email}} — awaiting their approval.', { email: target?.email }), 'success', 6000);
      setTransferTo('');
      refetch();
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('toast.offerFailed', 'Failed to offer ownership'), 'error');
    }
  }

  async function handleCancelOffer() {
    try {
      await declineOwnership({ variables: { companyId } });
      showToast(t('toast.offerCancelled', 'Ownership offer cancelled.'), 'info');
      refetch();
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('toast.cancelOfferFailed', 'Failed to cancel offer'), 'error');
    }
  }

  async function handleAcceptOwnership() {
    if (!confirm(t('toast.confirmAcceptOwnership', "Accept ownership of {{name}}? You'll become the owner and take over billing and team management.", { name: info?.name ?? t('danger.thisCompany', 'this company') }))) return;
    try {
      await acceptOwnership({ variables: { companyId } });
      showToast(t('toast.nowOwner', 'You are now the owner.'), 'success');
      refetch();
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('toast.acceptOwnershipFailed', 'Failed to accept ownership'), 'error');
    }
  }

  async function handleDeclineOffer() {
    try {
      await declineOwnership({ variables: { companyId } });
      showToast(t('toast.offerDeclined', 'Ownership offer declined.'), 'info');
      refetch();
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('toast.declineOfferFailed', 'Failed to decline offer'), 'error');
    }
  }

  async function handleDeleteCompany() {
    if (!confirm(t('toast.confirmDelete', 'Delete {{name}}? This permanently removes all its events, recipes, inventory, and team. This cannot be undone.', { name: info?.name ?? t('danger.thisCompany', 'this company') }))) return;
    try {
      await deleteCompany({ variables: { id: companyId } });
      showToast(t('toast.companyDeleted', 'Company deleted.'), 'info');
      navigate('/companies');
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('toast.deleteFailed', 'Failed to delete company'), 'error');
    }
  }

  const otherMembers = members.filter((m: { userId: string }) => m.userId !== user?.id);
  const pendingOwnerId = info?.pendingOwnerId ?? null;
  const pendingOwnerEmail = pendingOwnerId
    ? members.find((m: { userId: string; email: string }) => m.userId === pendingOwnerId)?.email ?? t('team.member', 'Member')
    : null;
  const isPendingRecipient = !!pendingOwnerId && pendingOwnerId === user?.id;

  if (loading) return <div className="card"><p style={{ color: 'var(--muted)' }}>{t('loading', 'Loading…')}</p></div>;

  return (
    <>
      <BackToSetupButton />
      {companyId && <LanguageRegionCard companyId={companyId} />}
      {/* POS Integration */}
      <div className="card">
        <div style={{ marginBottom: 16 }}>
          <h2 style={{ margin: '0 0 4px', color: 'var(--vv-navy)' }}>{t('heading', 'Settings')}</h2>
          <p style={{ margin: 0, color: 'var(--muted)', fontSize: '0.86rem' }}>{t('subtitle', 'Manage your company and integrations.')}</p>
        </div>

        <p style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 10px' }}>{t('integrations.eyebrow', 'Integrations')}</p>

        <div className="border border-[rgba(11,42,74,0.12)] rounded-[10px] p-4 mt-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-black rounded-md flex items-center justify-center flex-shrink-0">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <rect width="20" height="20" rx="3" fill="black"/>
                <rect x="5" y="5" width="10" height="10" rx="2" fill="white"/>
              </svg>
            </div>
            <div>
              <h3 className="m-0 mb-0.5 text-[0.95rem] font-semibold">{t('integrations.posName', '{{name}} POS', { name: posMeta.displayName })}</h3>
              <p className="m-0 text-[0.8rem] text-[#64748b]">{posMeta.blurb}</p>
            </div>
            <span className={`inline-flex items-center gap-1 px-2.5 py-[3px] rounded-full text-[0.74rem] font-semibold ml-auto ${posStatus?.connected ? 'bg-[#dcfce7] text-[#15803d]' : 'bg-[#f1f5f9] text-[#64748b]'}`}>
              {posStatus?.connected
                ? posStatus.locationName
                  ? t('integrations.connectedWithLocation', '✓ Connected — {{location}}', { location: posStatus.locationName })
                  : t('integrations.connected', '✓ Connected')
                : posMeta.implemented ? t('integrations.notConnected', 'Not Connected') : t('integrations.comingSoon', 'Coming Soon')}
            </span>
          </div>

          {posStatus?.connected ? (
            <>
              {posStatus.needsReauth && provider !== 'toast' && (
                <div style={{ marginTop: 14, borderRadius: 10, border: '1px solid #fde68a', background: '#fffbeb', padding: '12px 14px' }}>
                  <p style={{ margin: '0 0 10px', fontSize: '0.84rem', color: '#92400e' }}>
                    ⚠️ {t('integrations.reauthWarning', 'Your {{name}} connection stopped working (it may have expired or been revoked). Reconnect to keep syncing sales and labor.', { name: posMeta.displayName })}
                  </p>
                  <button className="btn-primary" style={{ fontSize: '0.85rem' }} onClick={handleConnectPos} disabled={connectingPos}>
                    {connectingPos && <span className="spinner" />}
                    <span>{t('integrations.reconnect', '🔄 Reconnect {{name}}', { name: posMeta.displayName })}</span>
                  </button>
                </div>
              )}
              <div style={{ marginTop: 14, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button className="btn-secondary" style={{ fontSize: '0.85rem' }} onClick={() => setShowPosMappings(true)}>
                  {t('integrations.manageMappings', '🗺 Manage POS Mappings')}
                </button>
                <button className="btn-danger-subtle" style={{ fontSize: '0.85rem' }} onClick={handleDisconnectPos}>
                  {t('integrations.disconnect', 'Disconnect {{name}}', { name: posMeta.displayName })}
                </button>
              </div>
            </>
          ) : provider === 'toast' ? (
            <div style={{ marginTop: 14, display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div className="form-group" style={{ margin: 0 }}>
                <label style={{ fontSize: '0.8rem' }}>{t('integrations.toastGuidLabel', 'Toast Restaurant GUID')}</label>
                <input
                  type="text"
                  value={toastGuid}
                  onChange={e => setToastGuid(e.target.value)}
                  placeholder={t('integrations.toastGuidPlaceholder', 'e.g. 1a2b3c4d-…')}
                  style={{ width: 280 }}
                />
              </div>
              <button className="btn-primary" style={{ fontSize: '0.85rem' }} onClick={handleConnectToast} disabled={connectingPos || !toastGuid.trim()}>
                {connectingPos && <span className="spinner" />} <span>{t('integrations.connectToast', 'Connect Toast')}</span>
              </button>
              <p style={{ fontSize: '0.78rem', color: 'var(--muted)', margin: '8px 0 0', flexBasis: '100%' }}>
                {t('integrations.toastGuidHelp', 'Find your restaurant GUID in Toast Web under Integrations, then paste it here to sync sales and labor.')}
              </p>
            </div>
          ) : posMeta.implemented ? (
            <div style={{ marginTop: 14 }}>
              <button className="btn-primary" onClick={handleConnectPos} disabled={connectingPos}>
                {connectingPos && <span className="spinner" />}
                <span>{t('integrations.connect', 'Connect {{name}}', { name: posMeta.displayName })}</span>
              </button>
              <p style={{ fontSize: '0.78rem', color: 'var(--muted)', margin: '8px 0 0' }}>
                {posMeta.blurb.includes('labor')
                  ? t('integrations.connectHelpLabor', 'Connect your {{name}} account to automatically sync sales, locations, and labor.', { name: posMeta.displayName })
                  : t('integrations.connectHelpNoLabor', 'Connect your {{name}} account to automatically sync sales and locations.', { name: posMeta.displayName })}
              </p>
            </div>
          ) : (
            <div style={{ marginTop: 14 }}>
              <p style={{ fontSize: '0.78rem', color: 'var(--muted)', margin: 0 }}>
                {t('integrations.comingSoonMessage', '{{name}} support is coming soon.', { name: posMeta.displayName })}
              </p>
            </div>
          )}
        </div>

        {/* TaxJar */}
        <div className="border border-[rgba(11,42,74,0.12)] rounded-[10px] p-4 mt-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-[#16a34a] rounded-md flex items-center justify-center flex-shrink-0 text-white">
              <i className="fa-solid fa-percent" />
            </div>
            <div>
              <h3 className="m-0 mb-0.5 text-[0.95rem] font-semibold">{t('taxjar.name', 'TaxJar')}</h3>
              <p className="m-0 text-[0.8rem] text-[#64748b]">{t('taxjar.blurb', 'Auto-look-up state & local sales tax rates by ZIP')}</p>
            </div>
            <span className={`inline-flex items-center gap-1 px-2.5 py-[3px] rounded-full text-[0.74rem] font-semibold ml-auto ${info?.taxjarConnected ? 'bg-[#dcfce7] text-[#15803d]' : 'bg-[#f1f5f9] text-[#64748b]'}`}>
              {info?.taxjarConnected ? t('taxjar.connected', '✓ Connected') : t('taxjar.notConnected', 'Not Connected')}
            </span>
          </div>

          {!isOwner ? (
            <p style={{ fontSize: '0.78rem', color: 'var(--muted)', margin: '12px 0 0' }}>
              {t('taxjar.ownerOnly', 'Only the company owner can manage the TaxJar connection.')}
            </p>
          ) : info?.taxjarConnected ? (
            <div style={{ marginTop: 14 }}>
              <button className="btn-danger-subtle" style={{ fontSize: '0.85rem' }} onClick={handleRemoveTaxjar}>
                {t('taxjar.disconnect', 'Disconnect TaxJar')}
              </button>
            </div>
          ) : (
            <div style={{ marginTop: 14, display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div className="form-group" style={{ margin: 0, flex: 1, minWidth: 240 }}>
                <label style={{ fontSize: '0.8rem' }}>{t('taxjar.tokenLabel', 'TaxJar API token')}</label>
                <input
                  type="password"
                  value={taxjarInput}
                  onChange={e => setTaxjarInput(e.target.value)}
                  placeholder={t('taxjar.tokenPlaceholder', 'Paste your TaxJar API token')}
                  autoComplete="off"
                  style={{ width: '100%' }}
                />
              </div>
              <button className="btn-primary" style={{ fontSize: '0.85rem' }} onClick={handleSaveTaxjar} disabled={savingTaxjar || !taxjarInput.trim()}>
                {savingTaxjar && <span className="spinner" />} <span>{t('taxjar.connect', 'Connect')}</span>
              </button>
              <p style={{ fontSize: '0.78rem', color: 'var(--muted)', margin: '4px 0 0', width: '100%' }}>
                <Trans
                  i18nKey="taxjar.tokenHelp"
                  ns="settings"
                  defaults="Get a token at <1>app.taxjar.com → Account → API Access</1>. Stored encrypted; never shown again."
                  components={{ 1: <span style={{ fontWeight: 600 }} /> }}
                />
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Company Details */}
      <div className="card">
        <h3 style={{ margin: '0 0 16px', color: 'var(--vv-navy)' }}>{t('companyDetails.heading', 'Company Details')}</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
          {[
            { key: 'name', label: t('companyDetails.name', 'Company Name') },
            { key: 'vendorCategory', label: t('companyDetails.vendorCategory', 'Vendor Category') },
            { key: 'contactName', label: t('companyDetails.contactName', 'Contact Name') },
            { key: 'phone', label: t('companyDetails.phone', 'Phone') },
            { key: 'email', label: t('companyDetails.email', 'Email') },
          ].map(f => (
            <div key={f.key} className="form-group">
              <label>{f.label}</label>
              <input
                type={f.key === 'email' ? 'email' : 'text'}
                value={companyForm[f.key as keyof typeof companyForm]}
                onChange={e => setCompanyForm(prev => ({ ...prev, [f.key]: e.target.value }))}
              />
            </div>
          ))}
        </div>
        <button className="btn-primary" onClick={saveCompanyDetails} disabled={savingCompany}>
          {savingCompany && <span className="spinner" />} <span>{t('companyDetails.save', 'Save Details')}</span>
        </button>
      </div>

      {/* Team Access */}
      <div id="team-access" className="card" style={{ scrollMarginTop: 16 }}>
        <p style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 6px' }}>{t('team.eyebrow', 'Team Access')}</p>
        <p style={{ fontSize: '0.84rem', color: 'var(--muted)', margin: '0 0 16px' }}>
          {t('team.description', 'Share events, inventory, and recipes with your team. Everyone in the same company sees the same data.')}
        </p>

        {/* Join code display */}
        {info?.joinCode && (
          <div style={{ background: '#f3f4f6', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px', marginBottom: 16, display: 'inline-block' }}>
            <p style={{ margin: '0 0 2px', fontSize: '0.72rem', color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase' }}>{t('team.joinCodeLabel', 'Your Join Code')}</p>
            <p style={{ margin: 0, fontSize: '1.2rem', fontWeight: 700, letterSpacing: '0.1em', color: 'var(--vv-navy)' }}>{info.joinCode}</p>
            <p style={{ margin: '2px 0 0', fontSize: '0.72rem', color: 'var(--muted)' }}>{t('team.joinCodeHelp', 'Share this with your team')}</p>
          </div>
        )}

        {/* Member list */}
        {members.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', marginBottom: 16 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <th style={{ padding: '6px 8px', textAlign: 'left', fontWeight: 600, color: 'var(--muted)', fontSize: '0.75rem' }}>{t('team.colEmail', 'Email')}</th>
                <th style={{ padding: '6px 8px', textAlign: 'left', fontWeight: 600, color: 'var(--muted)', fontSize: '0.75rem' }}>{t('team.colRole', 'Role')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {members.map((m: { userId: string; email: string; role: string }) => (
                <tr key={m.userId}>
                  <td style={{ padding: '6px 8px', borderBottom: '1px solid #f1f5f9' }}>{m.email}</td>
                  <td style={{ padding: '6px 8px', borderBottom: '1px solid #f1f5f9', color: 'var(--muted)', textTransform: 'capitalize' }}>
                    {m.role === 'owner' ? t('team.owner', '👑 Owner') : t('team.member', 'Member')}
                  </td>
                  <td style={{ padding: '6px 8px', borderBottom: '1px solid #f1f5f9' }}>
                    {m.role !== 'owner' && (
                      <button
                        className="btn-danger-subtle"
                        style={{ fontSize: '0.75rem', padding: '2px 8px' }}
                        onClick={() => handleRemoveMember(m.userId, m.email)}
                      >
                        {t('team.remove', 'Remove')}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* Invite member by email (owner only) */}
        {isOwner && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 16 }}>
            <div className="form-group" style={{ margin: 0, flex: 1, minWidth: 200 }}>
              <label style={{ fontSize: '0.8rem' }}>{t('team.inviteLabel', 'Invite member by email')}</label>
              <input
                type="email"
                value={inviteEmail}
                onChange={e => setInviteEmail(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleInvite(); }}
                placeholder={t('team.invitePlaceholder', 'name@example.com')}
                style={{ width: '100%' }}
              />
            </div>
            <button className="btn-primary" style={{ fontSize: '0.85rem' }} onClick={handleInvite} disabled={inviting || !inviteEmail.trim() || inviteCooldown > 0}>
              {inviting && <span className="spinner" />} <span>{inviteCooldown > 0 ? <>{t('team.inviteWait', 'Wait {{count}}s', { count: inviteCooldown })}</> : <><i className="fa-solid fa-user-plus" /> {t('team.invite', 'Invite')}</>}</span>
            </button>
          </div>
        )}

        {/* Pending access requests (owner only) */}
        {isOwner && pendingRequests.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <p style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 8px' }}>
              {t('team.pendingRequests', 'Pending requests ({{count}})', { count: pendingRequests.length })}
            </p>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <tbody>
                {pendingRequests.map((r: { userId: string; email: string }) => (
                  <tr key={r.userId}>
                    <td style={{ padding: '6px 8px', borderBottom: '1px solid #f1f5f9' }}>{r.email}</td>
                    <td style={{ padding: '6px 8px', borderBottom: '1px solid #f1f5f9', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button className="btn-primary" style={{ fontSize: '0.75rem', padding: '2px 10px', marginRight: 6 }} onClick={() => handleApprove(r.userId, r.email)}>
                        {t('team.approve', 'Approve')}
                      </button>
                      <button className="btn-danger-subtle" style={{ fontSize: '0.75rem', padding: '2px 10px' }} onClick={() => handleDeny(r.userId, r.email)}>
                        {t('team.deny', 'Deny')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Plan info */}
      <div className="card">
        <p style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 10px' }}>{t('subscription.eyebrow', 'Subscription')}</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span className={`inline-flex items-center text-[0.88rem] font-semibold px-[14px] py-1 rounded-full ${info?.plan === 'pro' ? 'bg-[#fef3c7] text-[#92400e]' : 'bg-[#f1f5f9] text-[#64748b]'}`}>
            {info?.plan === 'pro' ? <><i className="fa-solid fa-bolt" /> {t('subscription.planPro', 'venOS Pro')}</> : <><i className="fa-solid fa-clipboard-list" /> {t('subscription.planStarter', 'venOS Starter')}</>}
          </span>
          {info?.plan !== 'pro' && (
            <span style={{ fontSize: '0.82rem', color: 'var(--muted)' }}>
              {t('subscription.starterIncludes', 'Includes 1 finalized event and basic profit summary.')}
            </span>
          )}
        </div>
      </div>

      {/* Membership / danger zone */}
      <div className="card" style={{ borderColor: 'rgba(220,38,38,0.25)' }}>
        <p style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--danger)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 12px' }}>
          {isOwner ? t('danger.ownerControls', 'Owner controls') : t('danger.leaveCompany', 'Leave company')}
        </p>

        {/* Recipient of a pending ownership offer */}
        {isPendingRecipient && (
          <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '12px 14px', marginBottom: 16 }}>
            <p className="text-[#92400e] text-[0.88rem] font-semibold mt-0 mb-1">
              <i className="fa-solid fa-crown" /> {t('danger.offeredTitle', "You've been offered ownership of {{name}}.", { name: info?.name ?? t('danger.thisCompany', 'this company') })}
            </p>
            <p className="text-[#92400e] text-[0.82rem] mt-0 mb-3">{t('danger.offeredBody', 'Accepting makes you the owner, with control over billing and the team.')}</p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn-primary" style={{ fontSize: '0.85rem' }} onClick={handleAcceptOwnership}>
                <i className="fa-solid fa-check" /> {t('danger.acceptOwnership', 'Accept ownership')}
              </button>
              <button className="btn-secondary" style={{ fontSize: '0.85rem' }} onClick={handleDeclineOffer}>
                {t('danger.decline', 'Decline')}
              </button>
            </div>
          </div>
        )}

        {!isOwner && (
          <>
            <p className="text-[#64748b] text-[0.86rem] mt-0 mb-3">
              {t('danger.leaveDescription', "Remove yourself from {{name}}. You'll lose access until an owner invites you back.", { name: info?.name ?? t('danger.thisCompany', 'this company') })}
            </p>
            <button className="btn-danger-subtle" onClick={handleLeave}>
              <i className="fa-solid fa-right-from-bracket" /> {t('danger.leaveButton', 'Leave company')}
            </button>
          </>
        )}

        {isOwner && (
          <>
            <p className="text-[#64748b] text-[0.86rem] mt-0 mb-3">
              {t('danger.ownerDescription', "As the owner you can't leave directly. Transfer the company to another member (they must accept; you'll become a regular member and can then leave), or delete it entirely.")}
            </p>

            {pendingOwnerId ? (
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 18, background: '#f8fafc', borderRadius: 8, padding: '10px 14px' }}>
                <span className="text-[0.85rem] text-[#0B2A4A]">
                  <i className="fa-solid fa-clock" style={{ color: 'var(--muted)' }} /> <Trans
                    i18nKey="danger.offerPending"
                    ns="settings"
                    defaults="Ownership offer pending — awaiting <1>{{email}}</1>'s approval."
                    values={{ email: pendingOwnerEmail }}
                    components={{ 1: <strong /> }}
                  />
                </span>
                <button className="btn-secondary" style={{ fontSize: '0.8rem', padding: '3px 10px' }} onClick={handleCancelOffer}>
                  {t('danger.cancelOffer', 'Cancel offer')}
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 18 }}>
                <div className="form-group" style={{ margin: 0, minWidth: 220 }}>
                  <label style={{ fontSize: '0.8rem' }}>{t('danger.transferLabel', 'Transfer ownership to')}</label>
                  <select value={transferTo} onChange={e => setTransferTo(e.target.value)} disabled={otherMembers.length === 0} style={{ width: '100%' }}>
                    <option value="">{otherMembers.length === 0 ? t('danger.noOtherMembers', 'No other members yet') : t('danger.selectMember', 'Select a member…')}</option>
                    {otherMembers.map((m: { userId: string; email: string }) => (
                      <option key={m.userId} value={m.userId}>{m.email}</option>
                    ))}
                  </select>
                </div>
                <button className="btn-secondary" style={{ fontSize: '0.85rem' }} onClick={handleOffer} disabled={!transferTo}>
                  <i className="fa-solid fa-crown" /> {t('danger.offerOwnership', 'Offer ownership')}
                </button>
              </div>
            )}

            <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: 14 }}>
              <button className="btn-danger" onClick={handleDeleteCompany}>
                <i className="fa-solid fa-trash" /> {t('danger.deleteCompany', 'Delete company')}
              </button>
            </div>
          </>
        )}
      </div>

      {showPosMappings && companyId && (
        <PosMappingModal companyId={companyId} onClose={() => setShowPosMappings(false)} />
      )}
    </>
  );
}

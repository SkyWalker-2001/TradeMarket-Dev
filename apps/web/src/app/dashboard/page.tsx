'use client';

import { ChangeEvent, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Activity, ArrowDownLeft, ArrowUpRight, ChevronDown, CircleHelp, Command, Compass, Copy, Crown, Gift, LayoutDashboard, LogOut, Menu, Search, Settings2, ShieldCheck, Users, Wallet, X } from 'lucide-react';
import { apiRequest, API_URL, clearSession, getAuthToken, SessionUser } from '@/lib/api';

type Market = { symbol: string; name: string; price: number; change24h: number; color: string };
type Trade = { id: string; symbol: string; side: string; quantity: number; price: number; created_at: string };
type Dashboard = { data: { profile: { display_name: string | null; referral_code: string | null } | null; trades: Trade[]; membership: { tier_key: string; status: string; deposit_amount: string }; wallet: { depositTotal: string; earningsTotal: string; availableBalance: string } } };
type MarketsResponse = { data: Market[]; demo: boolean };
type ReferralNetwork = { code: string; directCount: number; networkCount: number; referrals: { referral_id: string; id: string; name: string; code: string; status: string; created_at: string; level: number }[] };
type WalletData = { config: { network: string; depositAddress: string; depositQr: string }; summary: { depositTotal: string; earningsTotal: string; availableBalance: string }; reward: { membershipStatus: string; depositAmount: string; rewardAmount: string; lastCollectedAt: string | null; pendingRequest: boolean; nextAvailableAt: string | null; canClaim: boolean } | null; transactions: { id: string; kind: string; direction?: 'credit'|'debit'|null; amount: string; status: string; txHash: string; walletAddress: string; note: string; requestReason?: string; cancellationReason?: string; reviewReason?: string; cancellationReviewReason?: string; createdAt: string; reviewedAt?: string | null }[] };

const fallbackMarkets: Market[] = [
  { symbol: 'BTC', name: 'Bitcoin', price: 67482.30, change24h: 2.84, color: '#f7931a' },
  { symbol: 'ETH', name: 'Ethereum', price: 3521.18, change24h: 1.62, color: '#8795f5' },
  { symbol: 'SOL', name: 'Solana', price: 182.76, change24h: -0.94, color: '#a78bfa' },
  { symbol: 'BNB', name: 'BNB', price: 594.22, change24h: 3.17, color: '#f3ba2f' },
];
const nav = [
  { label: 'Overview', icon: LayoutDashboard }, { label: 'Markets', icon: Activity },
  { label: 'Portfolio', icon: Wallet }, { label: 'Membership', icon: Crown },
  { label: 'Earnings', icon: Gift }, { label: 'Deposit', icon: ArrowDownLeft },
  { label: 'Withdraw', icon: ArrowUpRight }, { label: 'Referrals', icon: Users },
];
const money = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n);
const usdt = (n: string | number) => `${Number(n || 0).toFixed(2)} USDT`;
const tierForDeposit = (amount: number): 'starter' | 'growth' | 'pro' => amount >= 500 ? 'pro' : amount >= 100 ? 'growth' : 'starter';
const countdown = (ms: number) => { const seconds = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(seconds / 3600).toString().padStart(2, '0')}:${Math.floor((seconds % 3600) / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`; };

function Sparkline({ up = true }: { up?: boolean }) {
  const d = up ? 'M0 36 C14 33 19 39 30 27 S48 32 58 19 S78 28 90 12 S112 20 126 7' : 'M0 10 C14 8 22 18 33 11 S49 24 61 18 S78 28 91 21 S109 32 126 29';
  return <svg className="sparkline" viewBox="0 0 126 42" preserveAspectRatio="none" aria-hidden="true"><path d={d} fill="none" stroke={up ? '#e8a65a' : '#e17869'} strokeWidth="2.5" strokeLinecap="round" /></svg>;
}

function WalletHistory({ transactions, onCancel }: { transactions: WalletData['transactions']; onCancel?: (id: string, reason: string) => void }) {
  const [cancelReasons, setCancelReasons] = useState<Record<string, string>>({});
  return <div className="wallet-history"><div className="section-kicker">TRANSACTION HISTORY</div>{transactions.length ? transactions.map((item) => <div className="wallet-history-row" key={item.id}><span className={`wallet-kind ${item.kind}`}>{item.direction ? `${item.direction} adjustment` : item.kind.replace('_', ' ')}</span><b>{item.direction === 'debit' ? '−' : item.direction === 'credit' ? '+' : ''}{usdt(item.amount)}</b><span className={`wallet-status ${item.status}`}>{item.status.replace('_', ' ')}</span><small>{new Date(item.createdAt).toLocaleString()}{item.note ? ` · ${item.note}` : ''}</small>{item.requestReason && <small className="wallet-reason">Your request: {item.requestReason}</small>}{item.reviewReason && <small className="wallet-reason admin-reason">Admin: {item.reviewReason}</small>}{item.cancellationReason && <small className="wallet-reason">Cancellation request: {item.cancellationReason}</small>}{item.cancellationReviewReason && <small className="wallet-reason admin-reason">Admin cancellation decision: {item.cancellationReviewReason}</small>}{onCancel && item.kind === 'withdrawal' && item.status === 'pending' && <div className="wallet-cancel-control"><input aria-label="Cancellation reason" placeholder="Reason for cancellation" maxLength={500} value={cancelReasons[item.id] ?? ''} onChange={(event) => setCancelReasons((old) => ({ ...old, [item.id]: event.target.value }))}/><button onClick={() => onCancel(item.id, cancelReasons[item.id]?.trim() ?? '')} disabled={(cancelReasons[item.id]?.trim().length ?? 0) < 3}>Request cancellation</button></div>}</div>) : <div className="wallet-history-empty">No wallet transactions yet.</div>}</div>;
}

export default function Home() {
  const router = useRouter();
  const [markets, setMarkets] = useState(fallbackMarkets);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [membership, setMembership] = useState({ tier_key: 'none', status: 'inactive', deposit_amount: '0' });
  const [wallet, setWallet] = useState({ depositTotal: '0', earningsTotal: '0', availableBalance: '0' });
  const [walletInfo, setWalletInfo] = useState<WalletData | null>(null);
  const [settingsName, setSettingsName] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [walletAmount, setWalletAmount] = useState('10');
  const [depositTier, setDepositTier] = useState<'starter'|'growth'|'pro'>('starter');
  const [transactionHash, setTransactionHash] = useState('');
  const [depositScreenshot, setDepositScreenshot] = useState('');
  const [depositScreenshotName, setDepositScreenshotName] = useState('');
  const depositScreenshotInput = useRef<HTMLInputElement>(null);
  const [withdrawAddress, setWithdrawAddress] = useState('');
  const [withdrawReason, setWithdrawReason] = useState('');
  const [formBusy, setFormBusy] = useState(false);
  const [referralNetwork, setReferralNetwork] = useState<ReferralNetwork | null>(null);
  const [copyMessage, setCopyMessage] = useState('');
  const [user, setUser] = useState<SessionUser | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [active, setActive] = useState('Overview');
  const [selected, setSelected] = useState('BTC');
  const [quantity, setQuantity] = useState('0.01');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const [mobileNav, setMobileNav] = useState(false);
  const [clockNow, setClockNow] = useState(Date.now());
  const [ledgerType, setLedgerType] = useState('all');
  const [ledgerStatus, setLedgerStatus] = useState('all');
  const [ledgerSearch, setLedgerSearch] = useState('');
  const [ledgerFrom, setLedgerFrom] = useState('');
  const [ledgerTo, setLedgerTo] = useState('');
  const [ledgerMin, setLedgerMin] = useState('');
  const [ledgerMax, setLedgerMax] = useState('');

  useEffect(() => {
    fetch(`${API_URL}/markets`).then((r) => r.json()).then((d: MarketsResponse) => setMarkets(d.data)).catch(() => undefined);
    if (!getAuthToken()) { router.replace('/auth?next=/dashboard'); return; }
    apiRequest<{ user: SessionUser }>('/auth/me')
      .then(({ user: current }) => { setUser(current); setAuthReady(true); })
      .catch(() => { clearSession(); router.replace('/auth?next=/dashboard'); });
  }, [router]);

  useEffect(() => {
    if (!user) { setTrades([]); return; }
    Promise.all([apiRequest<Dashboard>('/dashboard'), apiRequest<{ data: WalletData }>('/wallet')]).then(([d, walletResponse]) => { setTrades(d.data.trades); setMembership(d.data.membership ?? { tier_key: 'none', status: 'inactive', deposit_amount: '0' }); setWallet(d.data.wallet); setWalletInfo(walletResponse.data); setSettingsName(d.data.profile?.display_name ?? user.name); }).catch(() => undefined);
  }, [user]);

  useEffect(() => {
    if (!user || active !== 'Referrals') return;
    apiRequest<{ data: ReferralNetwork }>('/referrals').then(({ data }) => setReferralNetwork(data)).catch(() => setCopyMessage('Could not load referral details.'));
  }, [active, user]);

  useEffect(() => {
    if (!user || !['Deposit', 'Withdraw', 'Earnings'].includes(active)) return;
    apiRequest<{ data: WalletData }>('/wallet').then(({ data }) => { setWalletInfo(data); setWallet(data.summary); }).catch((error) => setToast(error instanceof Error ? error.message : 'Could not load wallet.'));
  }, [active, user]);

  useEffect(() => {
    if (active !== 'Earnings') return;
    const timer = window.setInterval(() => setClockNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);

  const chosen = markets.find((m) => m.symbol === selected) ?? markets[0];
  async function paperTrade(side: 'buy' | 'sell') {
    if (!user) { router.replace('/auth?next=/dashboard'); return; }
    setBusy(true); setToast('');
    try {
      const result = await apiRequest<{ data: Trade; notice: string }>('/trades', { method: 'POST', body: JSON.stringify({ symbol: selected, side, quantity: Number(quantity) }) });
      setTrades((previous) => [result.data, ...previous]); setToast(result.notice);
    } catch (error) { setToast(error instanceof Error ? error.message : 'Could not record paper trade.'); }
    finally { setBusy(false); window.setTimeout(() => setToast(''), 4200); }
  }

  function signOut() { clearSession(); setUser(null); router.replace('/auth'); }

  async function copyInviteLink() {
    if (!referralNetwork?.code) return;
    const invite = new URL('/auth', window.location.origin);
    invite.searchParams.set('mode', 'signup');
    invite.searchParams.set('ref', referralNetwork.code);
    try { await navigator.clipboard.writeText(invite.toString()); setCopyMessage('Referral link copied.'); }
    catch { setCopyMessage(`Your referral code is ${referralNetwork.code}.`); }
    window.setTimeout(() => setCopyMessage(''), 3000);
  }

  async function refreshWallet() {
    const { data } = await apiRequest<{ data: WalletData }>('/wallet');
    setWalletInfo(data); setWallet(data.summary);
  }

  async function submitDeposit() {
    setToast('');
    if (!walletInfo?.config.depositAddress || !walletInfo.config.network) { setToast('The administrator has not configured the USDT network and deposit address yet.'); return; }
    if (!Number.isFinite(Number(walletAmount)) || Number(walletAmount) < 10) { setToast('Enter a deposit amount of at least 10 USDT.'); return; }
    if (transactionHash.trim().length < 16) { setToast('Enter the transaction hash from your payment.'); return; }
    setFormBusy(true);
    try {
      const result = await apiRequest<{ notice: string }>('/wallet/deposits', { method: 'POST', body: JSON.stringify({ tierKey: depositTier, amount: Number(walletAmount), txHash: transactionHash, ...(depositScreenshot ? { proofImage: depositScreenshot } : {}) }) });
      setToast(result.notice); setTransactionHash(''); setDepositScreenshot(''); setDepositScreenshotName(''); if (depositScreenshotInput.current) depositScreenshotInput.current.value = ''; await refreshWallet();
    } catch (error) { setToast(error instanceof Error ? error.message : 'Could not submit deposit.'); }
    finally { setFormBusy(false); }
  }

  function chooseDepositScreenshot(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 1_200_000) {
      setToast('Choose a PNG, JPEG, or WebP screenshot under 1.2 MB.'); event.target.value = ''; return;
    }
    const reader = new FileReader();
    reader.onload = () => { if (typeof reader.result === 'string') { setDepositScreenshot(reader.result); setDepositScreenshotName(file.name); setToast(''); } };
    reader.onerror = () => setToast('Could not read that screenshot.');
    reader.readAsDataURL(file);
  }

  async function submitWithdrawal() {
    setFormBusy(true); setToast('');
    try {
      const result = await apiRequest<{ notice: string }>('/wallet/withdrawals', { method: 'POST', body: JSON.stringify({ amount: Number(walletAmount), walletAddress: withdrawAddress, reason: withdrawReason }) });
      setToast(result.notice); setWalletAmount(''); setWithdrawAddress(''); setWithdrawReason(''); await refreshWallet();
    } catch (error) { setToast(error instanceof Error ? error.message : 'Could not submit withdrawal.'); }
    finally { setFormBusy(false); }
  }

  async function requestWithdrawalCancellation(id: string, reason: string) {
    if (reason.trim().length < 3) { setToast('Enter a reason for the cancellation request.'); return; }
    setFormBusy(true); setToast('');
    try { const result = await apiRequest<{ notice: string }>(`/wallet/withdrawals/${id}/cancel`, { method: 'PATCH', body: JSON.stringify({ reason: reason.trim() }) }); setToast(result.notice); await refreshWallet(); }
    catch (error) { setToast(error instanceof Error ? error.message : 'Could not request cancellation.'); }
    finally { setFormBusy(false); }
  }

  async function claimDailyReward() {
    setFormBusy(true); setToast('');
    try {
      const result = await apiRequest<{ notice: string }>('/wallet/rewards/claim', { method: 'POST', body: JSON.stringify({}) });
      setToast(result.notice); await refreshWallet();
    } catch (error) { setToast(error instanceof Error ? error.message : 'Could not request daily reward.'); }
    finally { setFormBusy(false); }
  }

  function exportLedger() {
    const rows = filteredTransactions;
    const csv = [['Date', 'Type', 'Status', 'Amount USDT', 'Destination', 'Transaction hash', 'Reason'], ...rows.map((item) => [item.createdAt, item.kind, item.status, item.amount, item.walletAddress, item.txHash, item.requestReason || item.note])]
      .map((row) => row.map((value) => `"${String(value ?? '').replaceAll('"', '""')}"`).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = 'trademarket-transactions.csv'; link.click(); URL.revokeObjectURL(url);
  }

  const filteredTransactions = (walletInfo?.transactions ?? []).filter((item) => {
    const search = `${item.kind} ${item.status} ${item.txHash} ${item.walletAddress} ${item.note} ${item.requestReason ?? ''} ${item.reviewReason ?? ''}`.toLowerCase();
    const amount = Number(item.amount); const day = item.createdAt.slice(0, 10);
    return (ledgerType === 'all' || item.kind === ledgerType) && (ledgerStatus === 'all' || item.status === ledgerStatus)
      && (!ledgerSearch || search.includes(ledgerSearch.toLowerCase())) && (!ledgerFrom || day >= ledgerFrom) && (!ledgerTo || day <= ledgerTo)
      && (!ledgerMin || amount >= Number(ledgerMin)) && (!ledgerMax || amount <= Number(ledgerMax));
  });

  async function saveSettings() {
    setFormBusy(true); setToast('');
    try {
      const result = await apiRequest<{ data: { displayName: string } }>('/settings', { method: 'PATCH', body: JSON.stringify({ displayName: settingsName }) });
      setSettingsName(result.data.displayName); setToast('Profile settings saved.');
    } catch (error) { setToast(error instanceof Error ? error.message : 'Could not save settings.'); }
    finally { setFormBusy(false); }
  }

  async function savePassword() {
    setFormBusy(true); setToast('');
    try {
      const result = await apiRequest<{ message: string }>('/settings/password', { method: 'PATCH', body: JSON.stringify({ currentPassword, newPassword }) });
      setToast(result.message); setCurrentPassword(''); setNewPassword('');
    } catch (error) { setToast(error instanceof Error ? error.message : 'Could not update password.'); }
    finally { setFormBusy(false); }
  }

  async function copyDepositAddress() {
    const address = walletInfo?.config.depositAddress;
    if (!address) return;
    try { await navigator.clipboard.writeText(address); setToast('Deposit address copied.'); }
    catch { setToast('Could not copy the address. Select and copy it manually.'); }
    window.setTimeout(() => setToast(''), 3000);
  }

  if (!authReady || !user) return <main className="auth-shell"><section className="auth-side"><p>Checking your account…</p></section></main>;

  return (
    <main className="shell">
      <aside className={`sidebar ${mobileNav ? 'sidebar-open' : ''}`}>
        <a className="brand" href="#top"><span className="brand-mark"><Command size={20} /></span><span>trade<span className="brand-accent">market</span><small>SMARTER MARKETS</small></span></a>
        <div className="workspace"><div className="workspace-icon">T</div><span><b>Trade Market</b><small>Personal workspace</small></span><ChevronDown size={15} /></div>
        <div className="nav-label">WORKSPACE</div>
        <nav>{nav.map(({ label, icon: Icon }) => <button key={label} className={`nav-link ${active === label ? 'active' : ''}`} onClick={() => { setActive(label); setMobileNav(false); }}><Icon size={17} /><span>{label}</span></button>)}</nav>
        <div className="sidebar-bottom"><div className="help-card"><div className="help-icon"><CircleHelp size={16} /></div><b>Need a hand?</b><p>Visit our help center to learn the platform.</p><small>Account support is available through your administrator.</small></div><button className={`nav-link ${active === 'Settings' ? 'active' : ''}`} onClick={() => setActive('Settings')}><Settings2 size={17} /><span>Settings</span></button><button className="profile" onClick={signOut}><span className="avatar">{user.email[0].toUpperCase()}</span><span className="profile-copy"><b>{user.email}</b><small>Click to sign out</small></span><LogOut size={16} /></button></div>
      </aside>
      {mobileNav && <button className="scrim" onClick={() => setMobileNav(false)} aria-label="Close navigation" />}
      <section className="main-area" id="top">
        <header className="topbar"><button className="mobile-menu icon-button" onClick={() => setMobileNav(true)} aria-label="Open menu"><Menu size={20} /></button><div className="breadcrumb">Workspace <span>/</span> <b>{active}</b></div><div className="top-actions"><div className="searchbox"><Search size={16} /><input placeholder="Search markets..." aria-label="Search markets" onChange={(e) => { const found = markets.find((m) => `${m.name} ${m.symbol}`.toLowerCase().includes(e.target.value.toLowerCase())); if (found && e.target.value.length > 1) setSelected(found.symbol); }} /></div><span className="top-divider" /><button className="top-profile" onClick={signOut}><span className="avatar small-avatar">{user.email[0].toUpperCase()}</span><ChevronDown size={14} /></button></div></header>
        <div className="content">
          {active === 'Overview' ? <div className="welcome-row"><div><div className="eyebrow"><span className="live-dot" /> ACCOUNT OVERVIEW <span className="eyebrow-divider">·</span> USDT LEDGER</div><h1>Welcome{settingsName ? `, ${settingsName}` : ''} <span className="wave">✳</span></h1><p className="subheading">Your deposit, earnings, and withdrawal balances are based on administrator-reviewed transactions.</p></div><button className="date-chip" onClick={() => setActive('Deposit')}><span className="date-dot" /> Deposit USDT <ArrowDownLeft size={14} /></button></div> : <div className="page-hero"><div className="eyebrow"><span className="live-dot" /> WORKSPACE / {active.toUpperCase()}</div><h1>{active}</h1><p className="subheading">{active === 'Markets' ? 'Explore sample market prices and daily movement.' : active === 'Portfolio' ? 'Review your simulated holdings and paper trade activity.' : active === 'Membership' ? 'Compare membership levels and review the deposit terms.' : active === 'Deposit' ? 'Submit a USDT transaction for manual administrator review.' : active === 'Withdraw' ? 'Send a withdrawal request to the administrator for review.' : active === 'Earnings' ? 'Request and track daily reward claims.' : active === 'Settings' ? 'Manage your account profile.' : 'Review your referral code and network tree.'}</p></div>}
          <div className={active === 'Overview' ? '' : 'hidden'}>
          <section className="stats-grid">
            <article className="stat-card featured"><div className="stat-top"><span>Total confirmed deposits</span><span className="stat-icon gold"><ArrowDownLeft size={17} /></span></div><div className="stat-value">{usdt(wallet.depositTotal)}</div><div className="stat-foot"><span className="muted">USDT deposits verified by admin</span></div><div className="card-glow" /></article>
            <article className="stat-card"><div className="stat-top"><span>Total earnings</span><span className="stat-icon green"><Gift size={17} /></span></div><div className="stat-value">{usdt(wallet.earningsTotal)}</div><div className="stat-foot"><span className="muted">Rewards approved by admin</span></div></article>
            <article className="stat-card"><div className="stat-top"><span>Withdrawable balance</span><span className="stat-icon violet"><ArrowUpRight size={17} /></span></div><div className="stat-value">{usdt(wallet.availableBalance)}</div><div className="stat-foot"><span className="muted">After pending and paid withdrawals</span></div></article>
            <article className="stat-card"><div className="stat-top"><span>Paper trades</span><span className="stat-icon blue"><Activity size={17} /></span></div><div className="stat-value">{trades.length.toString().padStart(2, '0')}<small> orders</small></div><div className="stat-foot"><span className="muted">Simulated activity</span></div></article>
          </section>

          <section className="market-layout">
            <article className="panel activity-panel"><div className="panel-heading"><div><div className="section-kicker">WALLET · USDT</div><h2>Transaction history</h2></div><button className="text-button" onClick={() => setActive('Deposit')}>Open wallet <ArrowUpRight size={14} /></button></div>{walletInfo ? <WalletHistory transactions={walletInfo.transactions.slice(0, 8)} /> : <div className="wallet-history-empty">Loading transactions…</div>}</article>
            <article className="panel membership-panel"><div className="membership-orb"><Crown size={22} /></div><div className="section-kicker">ACTIVE PLAN</div><h2>{membership.status === 'active' ? `${membership.tier_key} membership` : 'No active membership'}</h2>{membership.status === 'active' ? <><p>Your confirmed membership is active. Daily reward requests are calculated from your deposit.</p><div className="tier-progress"><div><span>Confirmed deposit</span><b>{usdt(membership.deposit_amount)}</b></div><div><span>Daily reward request · 0.1%</span><b>{usdt(Number(membership.deposit_amount) * 0.001)}</b></div><small>Reward claims are subject to administrator review.</small></div><button className="membership-cta" onClick={() => setActive('Earnings')}>Open earnings <ArrowUpRight size={15} /></button></> : <><p>Choose Starter, Growth, or Pro and submit the matching USDT deposit for review.</p><div className="tier-progress"><div><span>Available plans</span><b>10 · 100 · 500 USDT</b></div><small>Membership activates after an administrator confirms your deposit.</small></div><button className="membership-cta" onClick={() => setActive('Membership')}>View membership <ArrowUpRight size={15} /></button></>}<div className="membership-shine" /></article>
          </section>

          <section className="bottom-layout"><article className="panel activity-panel"><div className="panel-heading"><div><div className="section-kicker">RECENT ACTIVITY</div><h2>Paper trade history</h2></div><button className="text-button" onClick={() => setActive('Portfolio')}>View portfolio <ArrowUpRight size={14} /></button></div>{trades.length ? <div className="activity-list">{trades.slice(0, 4).map((t) => <div className="activity-row" key={t.id}><span className={`activity-icon ${t.side}`}><Activity size={15} /></span><span className="activity-desc"><b>{t.side === 'buy' ? 'Paper buy' : 'Paper sell'} {t.symbol}</b><small>{new Date(t.created_at).toLocaleString()}</small></span><span className="activity-qty">{Number(t.quantity).toFixed(4)} {t.symbol}<small>{money(Number(t.quantity) * Number(t.price))}</small></span></div>)}</div> : <div className="empty-state"><span className="empty-icon"><Compass size={19} /></span><div><b>No paper trades yet</b><p>Choose an asset and try a simulated order.</p></div><button onClick={() => document.querySelector('.trade-panel')?.scrollIntoView({ behavior: 'smooth' })}>Make a paper trade <ArrowUpRight size={14} /></button></div>}</article><article className="panel membership-panel"><div className="membership-orb"><Crown size={22} /></div><div className="section-kicker">MEMBERSHIP</div><h2>{membership.status === 'active' ? 'Your membership' : 'Choose a membership'}</h2><p>{membership.status === 'active' ? 'Your membership is active. Reward tools are shown in the Earnings section.' : 'Select a tier to submit its USDT deposit and request daily rewards.'}</p><div className="tier-progress"><div><span>Current tier</span><b>{membership.status === 'active' ? membership.tier_key : 'No active plan'}</b></div><div className="progress-track"><span /></div><small>Deposits and rewards require administrator review.</small></div><button className="membership-cta" onClick={() => setActive('Membership')}>View membership <ArrowUpRight size={15} /></button><div className="membership-shine" /></article></section>
          </div>
          {active !== 'Overview' && <section className="detail-page">
            {active === 'Markets' && <><article className="panel detail-panel"><div className="panel-heading"><div><div className="section-kicker">SAMPLE PRICES</div><h2>Market watchlist</h2></div><span className="paper-badge"><span /> DEMO DATA</span></div><div className="detail-markets">{markets.map((m) => <button className="detail-market" key={m.symbol} onClick={() => setSelected(m.symbol)}><span className="coin" style={{ '--coin': m.color } as React.CSSProperties}>{m.symbol[0]}</span><span><b>{m.name}</b><small>{m.symbol} / USD</small></span><strong>{money(m.price)}</strong><em className={m.change24h >= 0 ? 'positive' : 'negative'}>{m.change24h >= 0 ? '+' : ''}{m.change24h.toFixed(2)}%</em></button>)}</div><p className="detail-note">Prices are static sample values supplied by this prototype API, not live market data.</p></article><article className="panel trade-panel"><div className="panel-heading"><div><div className="section-kicker">PAPER MODE</div><h2>Quick trade</h2></div><span className="paper-badge"><span /> SIMULATED</span></div><div className="asset-select-label">SELECT ASSET</div><div className="asset-select">{markets.map((m) => <button className={selected === m.symbol ? 'coin-tab selected' : 'coin-tab'} key={m.symbol} onClick={() => setSelected(m.symbol)}><span className="coin mini" style={{ '--coin': m.color } as React.CSSProperties}>{m.symbol.slice(0, 1)}</span>{m.symbol}</button>)}</div><div className="selected-asset"><div><span>{chosen.name}</span><strong>{money(chosen.price)}</strong></div><span className={chosen.change24h >= 0 ? 'positive' : 'negative'}>{chosen.change24h >= 0 ? '+' : ''}{chosen.change24h.toFixed(2)}%</span></div><label className="input-label" htmlFor="quantity">QUANTITY <span>Available: paper balance</span></label><div className="quantity-input"><input id="quantity" value={quantity} onChange={(e) => setQuantity(e.target.value)} type="number" min="0.0001" step="0.001" /><span>{selected}</span></div><div className="trade-estimate"><span>Estimated total</span><b>{money((Number(quantity) || 0) * chosen.price)}</b></div><div className="trade-buttons"><button disabled={busy} onClick={() => paperTrade('buy')} className="buy-button"><ArrowUpRight size={16} /> Buy</button><button disabled={busy} onClick={() => paperTrade('sell')} className="sell-button"><ArrowDownLeft size={16} /> Sell</button></div><div className="disclaimer-mini"><ShieldCheck size={14} /> Paper trades only. No real orders are placed.</div></article></>}
            {active === 'Portfolio' && <article className="panel detail-panel"><div className="section-kicker">ACCOUNT · USDT LEDGER</div><div className="ledger-heading"><div><h2>Transaction history</h2><p className="detail-copy">Filter and export your deposits, withdrawals, rewards, and balance adjustments.</p></div><button className="text-button" onClick={exportLedger}>Export CSV</button></div><div className="ledger-summary"><div><span>Matching transactions</span><b>{filteredTransactions.length}</b></div><div><span>Confirmed deposits</span><b>{usdt(wallet.depositTotal)}</b></div><div><span>Available balance</span><b>{usdt(wallet.availableBalance)}</b></div></div><div className="ledger-filters"><label>Transaction type<select value={ledgerType} onChange={(event) => setLedgerType(event.target.value)}><option value="all">All types</option><option value="deposit">Deposits</option><option value="withdrawal">Withdrawals</option><option value="daily_reward">Rewards</option><option value="ledger_adjustment">Adjustments</option></select></label><label>Status<select value={ledgerStatus} onChange={(event) => setLedgerStatus(event.target.value)}><option value="all">All statuses</option><option value="pending">Pending</option><option value="confirmed">Confirmed</option><option value="paid">Paid</option><option value="rejected">Rejected</option><option value="cancel_requested">Cancellation pending</option><option value="cancelled">Cancelled</option></select></label><label>From<input type="date" value={ledgerFrom} onChange={(event) => setLedgerFrom(event.target.value)}/></label><label>To<input type="date" value={ledgerTo} onChange={(event) => setLedgerTo(event.target.value)}/></label><label>Minimum USDT<input type="number" min="0" step="0.01" placeholder="Any" value={ledgerMin} onChange={(event) => setLedgerMin(event.target.value)}/></label><label>Maximum USDT<input type="number" min="0" step="0.01" placeholder="Any" value={ledgerMax} onChange={(event) => setLedgerMax(event.target.value)}/></label><label className="ledger-search">Search note, address, or transaction hash<input value={ledgerSearch} onChange={(event) => setLedgerSearch(event.target.value)} placeholder="Enter a keyword"/></label><button className="ledger-reset" onClick={() => { setLedgerType('all'); setLedgerStatus('all'); setLedgerFrom(''); setLedgerTo(''); setLedgerMin(''); setLedgerMax(''); setLedgerSearch(''); }}>Reset filters</button></div>{walletInfo ? <WalletHistory transactions={filteredTransactions}/> : <div className="wallet-history-empty">Loading transactions…</div>}</article>}
            {active === 'Membership' && <article className="panel detail-panel"><div className="section-kicker">MEMBERSHIP TIERS · USDT</div><h2>{membership.status === 'active' ? `Active membership: ${membership.tier_key}` : 'Choose your membership'}</h2><p className="detail-copy">{membership.status === 'active' ? 'A membership is already active for this account. Contact the administrator to discuss a change.' : 'Submit the tier deposit below. Membership activates only after the administrator confirms the transaction on the selected network.'}</p><div className="tier-grid">{[{name:'Starter',key:'starter' as const,deposit:10,desc:'Market overview and paper trading'},{name:'Growth',key:'growth' as const,deposit:100,desc:'Expanded learning and progress views'},{name:'Pro',key:'pro' as const,deposit:500,desc:'Advanced research workspace'}].map(({name,key,deposit,desc}) => <div className="tier-card" key={name}><span className="membership-orb"><Crown size={18} /></span><b>{name}</b><p>{desc}</p><div className="tier-price">{deposit} <small>USDT deposit</small></div><div className="tier-reward">0.1% daily · {(deposit * 0.001).toFixed(2)} USDT request</div><button className="tier-subscribe" disabled={membership.status === 'active'} onClick={() => { setDepositTier(key); setWalletAmount(String(deposit)); setActive('Deposit'); }}>{membership.status === 'active' ? 'Membership active' : 'Continue to deposit'}</button></div>)}</div><p className="detail-note">Reward requests require an active membership and manual administrator review.</p></article>}
            {active === 'Referrals' && <article className="panel detail-panel"><div className="section-kicker">INVITE TRACKING</div><h2>Your referral network</h2><p className="detail-copy">Share your unique code. When someone registers with it, they appear in your network tree. Referral tracking does not currently create commissions or payouts.</p><div className="referral-callout"><Users size={20} /><span><b>Your referral code</b><small>{referralNetwork?.code ?? 'Loading your code…'}</small></span><button className="membership-cta" onClick={copyInviteLink} disabled={!referralNetwork?.code}><Copy size={14}/> Copy invite link</button></div>{copyMessage && <p className="referral-copy-message">{copyMessage}</p>}<div className="detail-stats"><div><span>Direct referrals</span><b>{referralNetwork?.directCount ?? '—'}</b></div><div><span>Total network</span><b>{referralNetwork?.networkCount ?? '—'}</b></div><div><span>Rewards</span><b>Not enabled</b></div></div><div className="referral-tree-panel"><div className="panel-heading"><div><div className="section-kicker">DOWNLINE</div><h2>Referral tree</h2></div><span className="paper-badge"><span/> TRACKING</span></div>{referralNetwork?.referrals.length ? <div className="referral-tree">{referralNetwork.referrals.map((entry) => <div className="referral-tree-row" key={entry.referral_id} style={{ marginLeft: `${Math.min(entry.level - 1, 5) * 22}px` }}><span className="referral-tree-branch"/><span className="avatar referral-avatar">{entry.name?.[0]?.toUpperCase() ?? 'U'}</span><span className="referral-tree-person"><b>{entry.name || 'Trade Market member'}</b><small>{entry.code} · Joined {new Date(entry.created_at).toLocaleDateString()}</small></span><span className="referral-level">Level {entry.level}</span></div>)}</div> : <div className="empty-state referral-empty"><span className="empty-icon"><Users size={18}/></span><div><b>No referrals yet</b><p>Share your invite link to start building your network.</p></div></div>}</div></article>}
            {active === 'Earnings' && <article className="panel detail-panel"><div className="section-kicker">MEMBERSHIP REWARDS · USDT</div><h2>{membership.status === 'active' ? 'Collect your daily reward' : 'Membership required'}</h2><p className="detail-copy">An active membership earns a reward request worth 0.1% of its confirmed deposit. Each approved collection starts a fresh 24-hour timer; delays shift your next eligible time from the actual collection.</p><div className="reward-claim-card"><div className="reward-amount"><span>Next reward amount</span><b>{usdt(walletInfo?.reward?.rewardAmount ?? (Number(membership.deposit_amount) * 0.001))}</b><small>Based on your {usdt(membership.deposit_amount)} confirmed membership deposit</small></div><div className="reward-countdown"><span>{walletInfo?.reward?.pendingRequest ? 'Request status' : walletInfo?.reward?.canClaim ? 'Reward ready' : 'Next collection in'}</span><b>{walletInfo?.reward?.pendingRequest ? 'Awaiting review' : walletInfo?.reward?.canClaim ? 'Available now' : walletInfo?.reward?.nextAvailableAt ? countdown(new Date(walletInfo.reward.nextAvailableAt).getTime() - clockNow) : '—'}</b>{walletInfo?.reward?.lastCollectedAt && <small>Last collected {new Date(walletInfo.reward.lastCollectedAt).toLocaleString()}</small>}</div><button className="reward-claim-button" onClick={claimDailyReward} disabled={formBusy || membership.status !== 'active' || !walletInfo?.reward?.canClaim}>{formBusy ? 'Submitting request…' : walletInfo?.reward?.pendingRequest ? 'Request under admin review' : walletInfo?.reward?.canClaim ? 'Collect reward' : 'Reward not ready'}</button></div><div className="reward-steps"><div><span>01 · Wait</span><b>24 hours between collections</b><small>Timer starts when the prior reward is approved and credited.</small></div><div><span>02 · Collect</span><b>Claim when the timer ends</b><small>A claim is queued for administrator approval.</small></div><div><span>03 · Earn</span><b>Added to earnings wallet</b><small>Approved rewards increase your earnings and withdrawable balance.</small></div></div><p className="detail-note">Reward requests need administrator approval. If review takes longer, the next 24-hour period begins at approval time, so your schedule moves with the actual collection.</p>{walletInfo && <WalletHistory transactions={walletInfo.transactions.filter((item) => item.kind === 'daily_reward')}/>}</article>}
            {active === 'Deposit' && <article className="panel detail-panel"><div className="section-kicker">FUND YOUR MEMBERSHIP · USDT</div><h2>Deposit</h2><p className="detail-copy">Enter the amount you are depositing. The plan is selected automatically from its minimum: Starter 10 USDT, Growth 100 USDT, or Pro 500 USDT. Your deposit stays pending until an administrator verifies it.</p>{walletInfo?.config.depositAddress ? <div className="deposit-address-card"><div><span>Network</span><b>{walletInfo.config.network}</b></div><div className="deposit-address-value"><span>USDT deposit address</span><code>{walletInfo.config.depositAddress}</code><button className="text-button" onClick={copyDepositAddress}><Copy size={13}/> Copy address</button></div>{walletInfo.config.depositQr && <img className="deposit-qr" src={walletInfo.config.depositQr} alt="USDT deposit QR code"/>}</div> : <div className="deposit-setup-note"><span>USDT deposits are waiting for the admin to add the receiving address for {walletInfo?.config.network || 'the USDT network'}.</span>{user?.role === 'admin' && <button onClick={() => router.push('/admin')}>Configure wallet</button>}</div>}<div className="wallet-form-grid"><label>USDT deposit amount<input type="number" min="10" step="0.01" value={walletAmount} onChange={(event) => { const value = event.target.value; setWalletAmount(value); if (Number(value) >= 10) setDepositTier(tierForDeposit(Number(value))); }} placeholder="Minimum 10 USDT" /></label><div className="deposit-tier-preview"><span>Selected membership</span><b>{depositTier[0].toUpperCase() + depositTier.slice(1)}</b><small>Daily reward request after approval: {usdt((Number(walletAmount) || 0) * 0.001)}</small></div><label className="wide-field">Transaction hash<input value={transactionHash} onChange={(event) => setTransactionHash(event.target.value)} placeholder="Paste the on-chain transaction hash" minLength={16} maxLength={200}/></label><label className="wide-field deposit-proof-picker">Payment screenshot <span>Optional · PNG, JPEG, or WebP up to 1.2 MB</span><input ref={depositScreenshotInput} type="file" accept="image/png,image/jpeg,image/webp" onChange={chooseDepositScreenshot}/>{depositScreenshotName&&<small>Attached: {depositScreenshotName}</small>}</label>{depositScreenshot&&<img className="deposit-proof-preview" src={depositScreenshot} alt="Payment screenshot preview"/>}<button className="landing-cta wallet-submit" onClick={submitDeposit} disabled={formBusy}>{formBusy ? 'Submitting…' : 'Submit deposit for review'}</button></div><p className="detail-note">Tier thresholds: 10–99.99 USDT Starter, 100–499.99 Growth, 500+ Pro. Only send USDT on the exact network shown. The app does not detect or reverse incorrect transfers.</p>{walletInfo && <WalletHistory transactions={walletInfo.transactions.filter((item) => item.kind === 'deposit')}/>}</article>}
            {active === 'Withdraw' && <article className="panel detail-panel"><div className="section-kicker">WALLET · USDT</div><h2>Request a withdrawal</h2><p className="detail-copy">Withdrawal requests go to the administrator. The administrator sends the transfer outside this app and records the transaction hash after completion.</p><div className="earning-wallet-card"><div><span>Withdrawable balance</span><b>{usdt(wallet.availableBalance)}</b></div><div><span>Network used for payout</span><b>{walletInfo?.config.network || 'Not configured'}</b></div></div><div className="wallet-form-grid"><label>Amount<input type="number" min="0.00000001" step="0.00000001" max={wallet.availableBalance} value={walletAmount} onChange={(event) => setWalletAmount(event.target.value)} placeholder="0.00"/></label><label className="wide-field">USDT destination address<input value={withdrawAddress} onChange={(event) => setWithdrawAddress(event.target.value)} placeholder="Paste your wallet address"/></label><label className="wide-field">Reason for withdrawal<textarea maxLength={500} value={withdrawReason} onChange={(event) => setWithdrawReason(event.target.value)} placeholder="Tell the admin why you are requesting this withdrawal"/></label><button className="landing-cta wallet-submit" onClick={submitWithdrawal} disabled={formBusy || !withdrawAddress || withdrawReason.trim().length < 3 || Number(walletAmount) <= 0 || Number(walletAmount) > Number(wallet.availableBalance)}>{formBusy ? 'Submitting…' : 'Send request to admin'}</button></div><p className="detail-note">The requested amount is reserved while pending. Requests are not sent automatically by the app.</p>{walletInfo && <WalletHistory transactions={walletInfo.transactions.filter((item) => item.kind === 'withdrawal')} onCancel={requestWithdrawalCancellation}/>}</article>}
            {active === 'Settings' && <article className="panel detail-panel"><div className="section-kicker">ACCOUNT SETTINGS</div><h2>Profile settings</h2><p className="detail-copy">Update your display name and sign-in password. Your email address is read-only.</p><div className="settings-form"><label>Display name<input value={settingsName} maxLength={80} onChange={(event) => setSettingsName(event.target.value)} /></label><label>Email address<input value={user.email} readOnly /></label><button className="landing-cta" onClick={saveSettings} disabled={formBusy || !settingsName.trim()}>{formBusy ? 'Saving…' : 'Save profile'}</button></div><div className="settings-divider"/><h2>Change password</h2><div className="settings-form"><label>Current password<input type="password" autoComplete="current-password" value={currentPassword} onChange={(event)=>setCurrentPassword(event.target.value)}/></label><label>New password<input type="password" minLength={8} autoComplete="new-password" value={newPassword} onChange={(event)=>setNewPassword(event.target.value)}/></label><button className="landing-cta" onClick={savePassword} disabled={formBusy||currentPassword.length<6||newPassword.length<8}>{formBusy?'Updating…':'Update password'}</button></div></article>}
          </section>}
          <footer className="footer"><span>© 2026 Trade Market <i>·</i> Account wallet and activity.</span></footer>
        </div>
      </section>
      {toast && <div className="toast"><ShieldCheck size={17} />{toast}<button onClick={() => setToast('')}><X size={15} /></button></div>}
    </main>
  );
}




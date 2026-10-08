'use client';

import { ChangeEvent, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Activity, ArrowDownLeft, ArrowLeft, ArrowUpRight, Check, Command, Crown, KeyRound,
  LayoutDashboard, Network, RefreshCw, Save, Search, ShieldAlert, ShieldCheck,
  Upload, UserRound, Users, Wallet, X, type LucideIcon,
} from 'lucide-react';
import { apiRequest, clearSession, getAuthToken, getStoredUser } from '@/lib/api';

type View = 'Overview' | 'Users' | 'Deposits' | 'Withdrawals' | 'Ledger' | 'Wallet settings' | 'Referrals';
type Summary = { members: number; paperTrades: number; referrals: number; memberships: number };
type Member = { id: string; email: string; name: string; referralCode: string; createdAt: string; deposits: string; earnings: string; available: string; directReferrals: number; membershipTier: string | null; membershipStatus: string | null };
type Transaction = { id: string; userId: string; email: string; userName: string; kind: string; tierKey: string | null; amount: string; status: string; txHash: string; walletAddress: string; note: string; requestReason?: string; cancellationReason?: string; reviewReason?: string; cancellationReviewReason?: string; direction: 'credit'|'debit'|null; proofAvailable: boolean; createdAt: string; reviewedAt: string | null; reviewerEmail: string | null };
type Finance = {
  config: { network: string; depositAddress: string; depositQr: string; updatedAt?: string };
  users: Member[];
  transactions: Transaction[];
  referrals: { id: string; status: string; createdAt: string; referrerEmail: string; referredEmail: string | null; referrerCode: string }[];
};
type ReviewAction = 'confirm_deposit' | 'confirm_reward' | 'pay_withdrawal' | 'reject' | 'approve_cancellation' | 'deny_cancellation';
const sections: { label: View; icon: LucideIcon }[] = [
  { label: 'Overview', icon: LayoutDashboard }, { label: 'Users', icon: Users },
  { label: 'Deposits', icon: ArrowDownLeft }, { label: 'Withdrawals', icon: ArrowUpRight },
  { label: 'Ledger', icon: Activity }, { label: 'Wallet settings', icon: Wallet },
  { label: 'Referrals', icon: Network },
];
const usdt = (value: string | number) => `${Number(value || 0).toFixed(2)} USDT`;
const shortId = (id: string) => `${id.slice(0, 8)}…${id.slice(-6)}`;

export default function AdminPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'loading'|'ready'|'forbidden'|'signed-out'|'error'>('loading');
  const [active, setActive] = useState<View>('Overview');
  const [summary, setSummary] = useState<Summary | null>(null);
  const [finance, setFinance] = useState<Finance | null>(null);
  const [message, setMessage] = useState('Checking admin access…');
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [network, setNetwork] = useState('');
  const [depositAddress, setDepositAddress] = useState('');
  const [depositQr, setDepositQr] = useState('');
  const [txHashes, setTxHashes] = useState<Record<string, string>>({});
  const [reviewReasons, setReviewReasons] = useState<Record<string, string>>({});
  const [proofImages, setProofImages] = useState<Record<string, string>>({});
  const [adjustmentUser, setAdjustmentUser] = useState('');
  const [adjustmentDirection, setAdjustmentDirection] = useState<'credit'|'debit'>('credit');
  const [adjustmentAmount, setAdjustmentAmount] = useState('');
  const [adjustmentReason, setAdjustmentReason] = useState('');

  async function load() {
    if (!getAuthToken()) { setStatus('signed-out'); setMessage('Sign in with an admin account to continue.'); return; }
    setEmail(getStoredUser()?.email ?? 'Admin');
    try {
      const [summaryResponse, financeResponse] = await Promise.all([
        apiRequest<{ data: Summary }>('/admin/summary'), apiRequest<{ data: Finance }>('/admin/finance'),
      ]);
      setSummary(summaryResponse.data); setFinance(financeResponse.data);
      setNetwork(financeResponse.data.config.network ?? '');
      setDepositAddress(financeResponse.data.config.depositAddress ?? '');
      setDepositQr(financeResponse.data.config.depositQr ?? '');
      setStatus('ready'); setMessage('');
    } catch (error) {
      const text = error instanceof Error ? error.message : 'Could not load admin data.';
      setStatus(text.includes('Admin access required') ? 'forbidden' : text.includes('Sign in') || text.includes('session') ? 'signed-out' : 'error');
      setMessage(text);
    }
  }
  useEffect(() => { void load(); }, []);

  const members = finance?.users ?? [];
  const transactions = finance?.transactions ?? [];
  const selectedMember = members.find((member) => member.id === selectedId) ?? null;
  const visibleMembers = useMemo(() => members.filter((member) => `${member.id} ${member.email} ${member.name} ${member.referralCode}`.toLowerCase().includes(query.toLowerCase())), [members, query]);
  const visibleTransactions = useMemo(() => transactions.filter((tx) => `${tx.email} ${tx.userName} ${tx.userId} ${tx.txHash} ${tx.kind} ${tx.status}`.toLowerCase().includes(query.toLowerCase())), [transactions, query]);
  const pendingDeposits = transactions.filter((tx) => tx.kind === 'deposit' && tx.status === 'pending').length;
  const pendingWithdrawals = transactions.filter((tx) => tx.kind === 'withdrawal' && tx.status === 'pending').length;

  function signOut() { clearSession(); router.push('/auth'); }
  function chooseMember(member: Member) {
    setSelectedId(member.id); setAdjustmentUser(member.id);
    setEditName(member.name); setEditEmail(member.email); setNewPassword('');
  }

  async function saveMember() {
    if (!selectedMember) return;
    setBusy(true); setFeedback('');
    try {
      await apiRequest(`/admin/users/${selectedMember.id}`, { method: 'PATCH', body: JSON.stringify({ name: editName, email: editEmail }) });
      setFeedback('Member profile updated.'); await load();
    } catch (error) { setFeedback(error instanceof Error ? error.message : 'Could not update member.'); }
    finally { setBusy(false); }
  }

  async function resetMemberPassword() {
    if (!selectedMember || newPassword.length < 8) { setFeedback('Enter a temporary password with at least 8 characters.'); return; }
    setBusy(true); setFeedback('');
    try {
      const result = await apiRequest<{ notice: string }>(`/admin/users/${selectedMember.id}/password`, { method: 'PATCH', body: JSON.stringify({ newPassword }) });
      setNewPassword(''); setFeedback(result.notice);
    } catch (error) { setFeedback(error instanceof Error ? error.message : 'Could not reset password.'); }
    finally { setBusy(false); }
  }

  async function saveWalletConfig() {
    setBusy(true); setFeedback('');
    try {
      await apiRequest('/admin/wallet-config', { method: 'PUT', body: JSON.stringify({ network, depositAddress, depositQr }) });
      setFeedback('Deposit wallet settings saved.'); await load();
    } catch (error) { setFeedback(error instanceof Error ? error.message : 'Could not save deposit settings.'); }
    finally { setBusy(false); }
  }

  function chooseQr(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 1_200_000) { setFeedback('Choose a PNG, JPEG, or WebP QR image under 1.2 MB.'); event.target.value = ''; return; }
    const reader = new FileReader();
    reader.onload = () => { if (typeof reader.result === 'string') setDepositQr(reader.result); };
    reader.onerror = () => setFeedback('Could not read that QR image.'); reader.readAsDataURL(file);
  }

  async function reviewTransaction(id: string, action: ReviewAction) {
    const txHash = txHashes[id]?.trim();
    const reviewReason = reviewReasons[id]?.trim();
    if (action === 'pay_withdrawal' && (!txHash || txHash.length < 16)) { setFeedback('Enter the payout transaction hash after sending the withdrawal.'); return; }
    if ((action === 'reject' || action === 'deny_cancellation') && (!reviewReason || reviewReason.length < 3)) { setFeedback('Enter a reason before refusing this request.'); return; }
    setBusy(true); setFeedback('');
    try {
      await apiRequest(`/admin/wallet-transactions/${id}`, { method: 'PATCH', body: JSON.stringify({ action, ...(txHash ? { txHash } : {}), ...((action === 'reject' || action === 'deny_cancellation') ? { reviewReason } : {}) }) });
      setFeedback('Transaction review saved.'); await load();
    } catch (error) { setFeedback(error instanceof Error ? error.message : 'Could not update transaction.'); }
    finally { setBusy(false); }
  }

  async function toggleProof(id: string) {
    if (proofImages[id]) { setProofImages((current) => { const next = { ...current }; delete next[id]; return next; }); return; }
    try {
      const result = await apiRequest<{ data: { proofImage: string } }>(`/admin/wallet-transactions/${id}/proof`);
      setProofImages((current) => ({ ...current, [id]: result.data.proofImage }));
    } catch (error) { setFeedback(error instanceof Error ? error.message : 'Could not load the payment screenshot.'); }
  }

  async function submitAdjustment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!adjustmentUser) { setFeedback('Choose a member for this ledger adjustment.'); return; }
    setBusy(true); setFeedback('');
    try {
      await apiRequest(`/admin/users/${adjustmentUser}/ledger-adjustments`, { method: 'POST', body: JSON.stringify({ direction: adjustmentDirection, amount: Number(adjustmentAmount), reason: adjustmentReason }) });
      setFeedback('Audited ledger adjustment recorded.'); setAdjustmentAmount(''); setAdjustmentReason(''); await load();
    } catch (error) { setFeedback(error instanceof Error ? error.message : 'Could not record ledger adjustment.'); }
    finally { setBusy(false); }
  }

  function renderTransactionTable(rows: Transaction[]) {
    return rows.length ? <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Member / ID</th><th>Type</th><th>Amount</th><th>Reference / Proof</th><th>Status</th><th>Action</th></tr></thead><tbody>{rows.map((tx) => <tr key={tx.id}>
      <td><b>{tx.userName || tx.email}</b><small>{tx.email}</small><small className="admin-mono">{shortId(tx.userId)}</small></td>
      <td>{tx.direction ? `${tx.direction} adjustment` : tx.kind.replace('_', ' ')}{tx.tierKey && <small>{tx.tierKey} membership</small>}{tx.note && <small title={tx.note}>{tx.note}</small>}{tx.requestReason && <small>Request: {tx.requestReason}</small>}{tx.cancellationReason && <small>Cancel: {tx.cancellationReason}</small>}{tx.reviewReason && <small>Refusal: {tx.reviewReason}</small>}{tx.cancellationReviewReason && <small>Cancel decision: {tx.cancellationReviewReason}</small>}</td>
      <td>{tx.direction === 'debit' ? '−' : tx.direction === 'credit' ? '+' : ''}{usdt(tx.amount)}</td>
      <td><span className="admin-reference">{tx.txHash || tx.walletAddress || '—'}</span><small>{new Date(tx.createdAt).toLocaleString()}</small>{tx.proofAvailable && <><button className="admin-proof-toggle" onClick={() => void toggleProof(tx.id)}>{proofImages[tx.id] ? 'Hide screenshot' : 'View screenshot'}</button>{proofImages[tx.id] && <a href={proofImages[tx.id]} target="_blank" rel="noreferrer"><img className="admin-proof-preview" src={proofImages[tx.id]} alt="User payment screenshot"/></a>}</>}</td>
      <td><span className={`wallet-status ${tx.status}`}>{tx.status}</span></td>
      <td>{tx.status === 'pending' || tx.status === 'cancel_requested' ? <div className="admin-row-actions admin-review-actions">{tx.status === 'cancel_requested' ? <><button disabled={busy} onClick={() => void reviewTransaction(tx.id, 'approve_cancellation')}>Approve cancellation</button><textarea aria-label="Reason for denying cancellation" maxLength={500} placeholder="Reason if denying cancellation" value={reviewReasons[tx.id] ?? ''} onChange={(event) => setReviewReasons((old) => ({ ...old, [tx.id]: event.target.value }))}/><button className="reject-action" disabled={busy || (reviewReasons[tx.id]?.trim().length ?? 0) < 3} onClick={() => void reviewTransaction(tx.id, 'deny_cancellation')}>Deny cancellation</button></> : tx.kind === 'withdrawal' ? <><input aria-label="Payout transaction hash" placeholder="Payout tx hash" value={txHashes[tx.id] ?? ''} onChange={(event) => setTxHashes((old) => ({ ...old, [tx.id]: event.target.value }))}/><button disabled={busy} onClick={() => void reviewTransaction(tx.id, 'pay_withdrawal')}>Mark paid</button><textarea aria-label="Reason for refusing withdrawal" maxLength={500} placeholder="Reason for refusal" value={reviewReasons[tx.id] ?? ''} onChange={(event) => setReviewReasons((old) => ({ ...old, [tx.id]: event.target.value }))}/><button className="reject-action" disabled={busy || (reviewReasons[tx.id]?.trim().length ?? 0) < 3} onClick={() => void reviewTransaction(tx.id, 'reject')}>Reject</button></> : <><button disabled={busy} onClick={() => void reviewTransaction(tx.id, tx.kind === 'deposit' ? 'confirm_deposit' : 'confirm_reward')}><Check size={12}/>{tx.kind === 'deposit' ? 'Confirm deposit' : 'Approve reward'}</button><textarea aria-label="Reason for refusing request" maxLength={500} placeholder="Reason for refusal" value={reviewReasons[tx.id] ?? ''} onChange={(event) => setReviewReasons((old) => ({ ...old, [tx.id]: event.target.value }))}/><button className="reject-action" disabled={busy || (reviewReasons[tx.id]?.trim().length ?? 0) < 3} onClick={() => void reviewTransaction(tx.id, 'reject')}><X size={12}/>Reject</button></>}</div> : <small>{tx.reviewerEmail ? `Reviewed by ${tx.reviewerEmail}` : 'Reviewed'}{tx.reviewReason && <span className="admin-review-reason">Reason: {tx.reviewReason}</span>}{tx.cancellationReviewReason && <span className="admin-review-reason">Cancellation decision: {tx.cancellationReviewReason}</span>}</small>}</td>
    </tr>)}</tbody></table></div> : <div className="admin-empty">No matching transactions.</div>;
  }

  function panel(title: string, kicker: string, description: string, content: React.ReactNode) {
    return <section className="admin-data-panel"><div className="section-kicker">{kicker}</div><h2>{title}</h2>{description && <p className="admin-panel-copy">{description}</p>}{content}</section>;
  }

  const searchBox = (placeholder: string) => <label className="admin-search"><Search size={14}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={placeholder}/><button onClick={() => setQuery('')} aria-label="Clear search"><X size={13}/></button></label>;

  function renderContent() {
    if (!finance || !summary) return null;
    if (active === 'Overview') return <>
      <section className="admin-stat-grid">{[
        { label: 'Registered users', value: summary.members, icon: Users },
        { label: 'Pending deposits', value: pendingDeposits, icon: ArrowDownLeft },
        { label: 'Pending withdrawals', value: pendingWithdrawals, icon: ArrowUpRight },
        { label: 'Active memberships', value: members.filter((member) => member.membershipStatus === 'active').length, icon: Crown },
      ].map(({ label, value, icon: Icon }) => <article className="admin-stat" key={label}><span className="admin-stat-icon"><Icon size={17}/></span><small>{label}</small><b>{value.toLocaleString()}</b><em>Current records</em></article>)}</section>
      {panel('Recent ledger activity', 'LATEST TRANSACTIONS', '', renderTransactionTable(transactions.slice(0, 8)))}
    </>;

    if (active === 'Users') return <>
      {panel('Member accounts', 'USER MANAGEMENT', 'View immutable account IDs and balances. Edit member contact details or reset a password; existing passwords are never viewable.', <>
        {searchBox('Search name, email, referral code, or ID')}
        <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>User ID</th><th>Member</th><th>Membership</th><th>Deposits</th><th>Earnings</th><th>Available</th><th>Referrals</th><th>Action</th></tr></thead><tbody>{visibleMembers.map((member) => <tr key={member.id} className={member.id === selectedId ? 'admin-selected-row' : ''}><td className="admin-mono">{shortId(member.id)}</td><td><b>{member.name || member.email}</b><small>{member.email}</small></td><td>{member.membershipStatus === 'active' ? member.membershipTier : 'None'}</td><td>{usdt(member.deposits)}</td><td>{usdt(member.earnings)}</td><td>{usdt(member.available)}</td><td>{member.directReferrals}</td><td><button className="admin-table-action" onClick={() => chooseMember(member)}>Manage</button></td></tr>)}</tbody></table></div>
      </>)}
      {selectedMember && panel(`Manage ${selectedMember.name || selectedMember.email}`, 'MEMBER ACCOUNT', '', <div className="admin-member-editor">
        <div className="admin-id-card"><small>Immutable user ID</small><code>{selectedMember.id}</code><small>Joined {new Date(selectedMember.createdAt).toLocaleString()}</small></div>
        <div className="admin-editor-grid"><label>Display name<input value={editName} onChange={(event) => setEditName(event.target.value)} maxLength={80}/></label><label>Email address<input value={editEmail} onChange={(event) => setEditEmail(event.target.value)} type="email" maxLength={254}/></label><button className="admin-refresh" disabled={busy || !editName.trim() || !editEmail.trim()} onClick={() => void saveMember()}><Save size={13}/>Save profile</button></div>
        <div className="admin-password-reset"><div><KeyRound size={16}/><span><b>Reset password</b><small>Choose a temporary password. This revokes the member’s current sessions. Never ask for or display their existing password.</small></span></div><label>New temporary password<input type="password" autoComplete="new-password" minLength={8} maxLength={128} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="At least 8 characters"/></label><button className="admin-row-button" disabled={busy || newPassword.length < 8} onClick={() => void resetMemberPassword()}>Reset password</button></div>
        <div className="admin-member-balance"><span>Deposit <b>{usdt(selectedMember.deposits)}</b></span><span>Earnings <b>{usdt(selectedMember.earnings)}</b></span><span>Withdrawable <b>{usdt(selectedMember.available)}</b></span></div>
        <h3 className="admin-subheading">Member transaction history</h3>{renderTransactionTable(transactions.filter((tx) => tx.userId === selectedMember.id))}
      </div>)}
      {!selectedMember && <div className="admin-empty">Select a member to edit profile details, reset access, and review their ledger.</div>}
    </>;

    if (active === 'Deposits') return panel('Deposit requests', 'DEPOSIT REVIEW', 'Verify the transaction hash and any attached payment screenshot on the configured network before confirming a deposit.', renderTransactionTable(visibleTransactions.filter((tx) => tx.kind === 'deposit')));
    if (active === 'Withdrawals') return panel('Withdrawal requests', 'WITHDRAWAL REVIEW', 'Review the request and destination. Send funds from the external wallet, then record the payout transaction hash to mark it paid.', renderTransactionTable(visibleTransactions.filter((tx) => tx.kind === 'withdrawal')));
    if (active === 'Ledger') return <>
      {panel('All wallet transactions', 'ACCOUNT LEDGER', 'Ledger entries are append-only. Review pending deposits, rewards, and withdrawals above; post a reasoned adjustment below when a balance correction is needed.', <>{searchBox('Search member, ID, tx hash, type, or status')}{renderTransactionTable(visibleTransactions)}</>)}
      {panel('Post an audited balance adjustment', 'LEDGER CORRECTION', 'Credits and debits become permanent ledger entries with the admin, timestamp, and reason recorded. Debit adjustments cannot exceed the available balance.', <form className="admin-adjustment-form" onSubmit={(event) => void submitAdjustment(event)}><label>Member<select required value={adjustmentUser} onChange={(event) => setAdjustmentUser(event.target.value)}><option value="">Select member</option>{members.map((member) => <option key={member.id} value={member.id}>{member.name || member.email} · {member.email}</option>)}</select></label><label>Direction<select value={adjustmentDirection} onChange={(event) => setAdjustmentDirection(event.target.value as 'credit'|'debit')}><option value="credit">Credit balance</option><option value="debit">Debit balance</option></select></label><label>Amount (USDT)<input required type="number" min="0.00000001" step="0.00000001" value={adjustmentAmount} onChange={(event) => setAdjustmentAmount(event.target.value)} placeholder="0.00"/></label><label className="admin-adjustment-reason">Reason<input required minLength={3} maxLength={500} value={adjustmentReason} onChange={(event) => setAdjustmentReason(event.target.value)} placeholder="Explain the correction for the audit record"/></label><button className="admin-row-button" type="submit" disabled={busy || !adjustmentUser || Number(adjustmentAmount) <= 0 || adjustmentReason.trim().length < 3}>{busy ? 'Saving…' : 'Post ledger entry'}</button></form>)}
    </>;

    if (active === 'Wallet settings') return panel('Receiving wallet', 'USDT DEPOSIT SETTINGS', 'Set the network and public address shown to members. The app does not store private keys or send blockchain transactions.', <div className="admin-wallet-form"><label>USDT network<input value={network} onChange={(event) => setNetwork(event.target.value)} placeholder="BEP20 (USDT)" maxLength={60}/></label><label>Deposit address<input value={depositAddress} onChange={(event) => setDepositAddress(event.target.value)} placeholder="Public receiving wallet address" maxLength={200}/></label><label className="admin-qr-picker">QR image<input type="file" accept="image/png,image/jpeg,image/webp" onChange={chooseQr}/><small><Upload size={12}/>PNG, JPEG, or WebP up to 1.2 MB</small></label>{depositQr && <img className="admin-qr-preview" src={depositQr} alt="Deposit QR preview"/>}<button className="admin-refresh admin-save" disabled={busy || !network.trim() || !depositAddress.trim()} onClick={() => void saveWalletConfig()}><Save size={14}/>{busy ? 'Saving…' : 'Save wallet settings'}</button></div>);
    return panel('Referral history', 'REFERRAL SYSTEM', 'Track which member invited each new account and when the referral joined.', finance.referrals.length ? <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Referrer</th><th>Referral code</th><th>Joined member</th><th>Status</th><th>Date</th></tr></thead><tbody>{finance.referrals.map((item) => <tr key={item.id}><td>{item.referrerEmail}</td><td>{item.referrerCode}</td><td>{item.referredEmail ?? 'Account removed'}</td><td>{item.status}</td><td>{new Date(item.createdAt).toLocaleDateString()}</td></tr>)}</tbody></table></div> : <div className="admin-empty">No referred accounts yet.</div>);
  }

  return <main className="admin-shell"><header className="admin-topbar"><Link href="/" className="brand"><span className="brand-mark"><Command size={19}/></span><span>trade<span className="brand-accent">market</span><small>ADMIN CONSOLE</small></span></Link><div className="admin-top-actions"><span className="admin-user"><i/><span>{email || 'Admin access'}</span></span>{status === 'ready' && <><button className="admin-refresh" onClick={() => void load()}><RefreshCw size={14}/>Refresh</button><button className="admin-signout" onClick={signOut}>Sign out</button></>}</div></header>
    {status === 'ready' ? <div className="admin-workspace"><aside className="admin-sidebar"><div className="admin-sidebar-label">CONTROL PANEL</div>{sections.map(({ label, icon: Icon }) => <button key={label} className={active === label ? 'admin-nav-item active' : 'admin-nav-item'} onClick={() => { setActive(label); setQuery(''); setFeedback(''); }}><Icon size={16}/><span>{label}</span>{label === 'Deposits' && pendingDeposits > 0 && <em>{pendingDeposits}</em>}{label === 'Withdrawals' && pendingWithdrawals > 0 && <em>{pendingWithdrawals}</em>}</button>)}<Link className="admin-sidebar-back" href="/dashboard"><ArrowLeft size={14}/>Member dashboard</Link></aside><div className="admin-main"><div className="admin-page-heading"><div><div className="landing-eyebrow"><span/> PLATFORM CONTROL</div><h1>{active}</h1><p>{active === 'Overview' ? 'Manage members, USDT requests, wallet settings, and account ledger.' : active === 'Users' ? 'Manage member identity and access.' : active === 'Deposits' ? 'Verify incoming membership payments.' : active === 'Withdrawals' ? 'Review and fulfill member payout requests.' : active === 'Ledger' ? 'Inspect transaction history and record balance corrections.' : active === 'Wallet settings' ? 'Configure the USDT network and receiving details.' : 'Review member invitation activity.'}</p></div><div className="admin-heading-actions"><span className="admin-secure-badge"><ShieldCheck size={14}/>Admin verified</span></div></div>{feedback && <div className="admin-feedback-banner">{feedback}<button onClick={() => setFeedback('')} aria-label="Dismiss"><X size={14}/></button></div>}{renderContent()}<footer className="admin-footer"><span>Trade Market · Admin console</span><span>Reviewed changes are recorded in the ledger.</span></footer></div></div> : <div className="admin-gate"><Link href="/" className="brand"><span className="brand-mark"><Command size={19}/></span><span>trade<span className="brand-accent">market</span></span></Link><span className={status === 'forbidden' ? 'gate-icon warning' : 'gate-icon'}>{status === 'forbidden' ? <ShieldAlert size={22}/> : <ShieldCheck size={22}/>}</span><h2>{status === 'loading' ? 'Verifying your access…' : status === 'forbidden' ? 'Admin access required' : status === 'signed-out' ? 'Sign in to continue' : 'Admin panel unavailable'}</h2><p>{message}</p>{status === 'signed-out' && <Link className="landing-cta" href="/auth?next=/admin">Sign in <ArrowUpRight size={15}/></Link>}{status === 'forbidden' && <div className="admin-role-hint">Ask a project administrator to set this account’s role to <code>admin</code>.</div>}{status === 'error' && <button className="admin-refresh" onClick={() => void load()}>Try again <RefreshCw size={14}/></button>}</div>}
  </main>;
}

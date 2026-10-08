import dotenv from 'dotenv';
dotenv.config({ path: '../../.env' });
import express, { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Pool } from 'pg';
import { z } from 'zod';

const app = express();
app.use(cors({ origin: process.env.WEB_ORIGIN ?? 'http://localhost:3000' }));
app.use(express.json({ limit: '3mb' }));

const jwtSecret = process.env.JWT_SECRET ?? (process.env.NODE_ENV === 'production' ? '' : 'local-development-secret-change-before-deploying-32chars');
if (jwtSecret.length < 32) throw new Error('JWT_SECRET must be set to at least 32 characters.');
const pool = new Pool({
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 5432),
  database: process.env.DB_NAME ?? process.env.POSTGRES_DB ?? 'trademarket',
  user: process.env.DB_USER ?? process.env.POSTGRES_USER ?? 'trademarket',
  password: process.env.DB_PASSWORD ?? process.env.POSTGRES_PASSWORD ?? 'trademarket',
  max: 10,
});

type AuthedRequest = Request & { userId?: string; userEmail?: string };
const asyncRoute = (fn: (req: AuthedRequest, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => Promise.resolve(fn(req as AuthedRequest, res)).catch(next);

const demoMarkets = [
  { symbol: 'BTC', name: 'Bitcoin', price: 67482.3, change24h: 2.84, color: '#f7931a' },
  { symbol: 'ETH', name: 'Ethereum', price: 3521.18, change24h: 1.62, color: '#8795f5' },
  { symbol: 'SOL', name: 'Solana', price: 182.76, change24h: -0.94, color: '#a78bfa' },
  { symbol: 'BNB', name: 'BNB', price: 594.22, change24h: 3.17, color: '#f3ba2f' },
];

function requireUser(req: AuthedRequest, res: Response, next: NextFunction) {
  const token = req.header('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Sign in to continue.' });
  try {
    const claims = jwt.verify(token, jwtSecret, { issuer: 'trade-market-api', audience: 'trade-market-web' }) as jwt.JwtPayload;
    if (typeof claims.sub !== 'string' || typeof claims.email !== 'string') throw new Error('Invalid token claims');
    void pool.query('select token_version from users where id = $1', [claims.sub]).then((result) => {
      const version = result.rows[0] ? Number(result.rows[0].token_version) : -1;
      if (version < 0 || version !== Number(claims.ver ?? 0)) return res.status(401).json({ error: 'Your session has been revoked. Sign in again.' });
      req.userId = claims.sub as string;
      req.userEmail = claims.email as string;
      next();
    }).catch(next);
  } catch { return res.status(401).json({ error: 'Your session is invalid or has expired.' }); }
}

async function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
  try {
    const result = await pool.query('select role from users where id = $1', [req.userId]);
    if (result.rows[0]?.role !== 'admin') return res.status(403).json({ error: 'Admin access required.' });
    next();
  } catch (error) { next(error); }
}

const credentialsSchema = z.object({ email: z.string().email().max(254).transform((value) => value.trim().toLowerCase()), password: z.string().min(6).max(128) });
const registerSchema = credentialsSchema.extend({
  name: z.string().trim().min(1).max(80).optional(),
  referralCode: z.string().trim().min(3).max(32).transform((value) => value.toUpperCase()).optional().or(z.literal('')),
});

function issueToken(user: { id: string; email: string; role: string; display_name: string; token_version: number }) {
  const token = jwt.sign({ email: user.email, ver: user.token_version }, jwtSecret, { subject: user.id, expiresIn: '8h', issuer: 'trade-market-api', audience: 'trade-market-web' });
  return { token, user: { id: user.id, email: user.email, name: user.display_name, role: user.role } };
}

app.get('/api/v1/health', asyncRoute(async (_req, res) => {
  await pool.query('select 1');
  res.json({ status: 'ok', service: 'trade-market-api', database: 'ok' });
}));
app.get('/api/v1/markets', (_req, res) => res.json({ data: demoMarkets, asOf: new Date().toISOString(), demo: true }));

app.post('/api/v1/auth/register', asyncRoute(async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Enter a valid email, password (at least 6 characters), and optional name.' });
  const { email, password, name, referralCode } = parsed.data;
  const passwordHash = await bcrypt.hash(password, 12);
  const client = await pool.connect();
  try {
    await client.query('begin');
    let referrerId: string | null = null;
    if (referralCode) {
      const referrer = await client.query('select id, email from users where referral_code = $1 for share', [referralCode]);
      if (!referrer.rows[0]) {
        await client.query('rollback');
        return res.status(400).json({ error: 'That referral code was not found.' });
      }
      if (referrer.rows[0].email === email) {
        await client.query('rollback');
        return res.status(400).json({ error: 'You cannot refer your own account.' });
      }
      referrerId = referrer.rows[0].id;
    }
    const inserted = await client.query(
      'insert into users (email, password_hash, display_name) values ($1, $2, $3) returning id, email, role, display_name, token_version',
      [email, passwordHash, name ?? email.split('@')[0]],
    );
    const user = inserted.rows[0];
    await client.query("insert into user_memberships (user_id, tier_key, status) values ($1, 'starter', 'demo')", [user.id]);
    if (referrerId) await client.query("insert into referrals (referrer_id, referred_user_id, status) values ($1, $2, 'joined')", [referrerId, user.id]);
    await client.query('commit');
    res.status(201).json(issueToken(user));
  } catch (error: unknown) {
    await client.query('rollback');
    if ((error as { code?: string }).code === '23505') return res.status(409).json({ error: 'An account with that email already exists.' });
    throw error;
  } finally { client.release(); }
}));

app.post('/api/v1/auth/login', asyncRoute(async (req, res) => {
  const parsed = credentialsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Enter a valid email and password.' });
  const { rows } = await pool.query('select id, email, password_hash, role, display_name, token_version from users where email = $1', [parsed.data.email]);
  const user = rows[0];
  if (!user || !(await bcrypt.compare(parsed.data.password, user.password_hash))) return res.status(401).json({ error: 'Email or password is incorrect.' });
  res.json(issueToken(user));
}));

app.get('/api/v1/auth/me', requireUser, asyncRoute(async (req, res) => {
  const { rows } = await pool.query('select id, email, role, display_name as name from users where id = $1', [req.userId]);
  if (!rows[0]) return res.status(401).json({ error: 'Account no longer exists.' });
  res.json({ user: rows[0] });
}));

app.get('/api/v1/admin/summary', requireUser, requireAdmin, asyncRoute(async (_req, res) => {
  const [members, paperTrades, referrals, memberships] = await Promise.all([
    pool.query('select count(*)::int as count from users'),
    pool.query('select count(*)::int as count from paper_trades'),
    pool.query('select count(*)::int as count from referrals'),
    pool.query('select count(*)::int as count from user_memberships'),
  ]);
  res.json({ data: { members: members.rows[0].count, paperTrades: paperTrades.rows[0].count, referrals: referrals.rows[0].count, memberships: memberships.rows[0].count } });
}));

app.get('/api/v1/admin/finance', requireUser, requireAdmin, asyncRoute(async (_req, res) => {
  const [config, users, referrals, transactions] = await Promise.all([
    pool.query('select usdt_network as network, deposit_address as "depositAddress", deposit_qr_data_url as "depositQr", updated_at as "updatedAt" from platform_wallet_config where id = 1'),
    pool.query(`with balances as (
      select user_id,
        coalesce(sum(amount) filter (where kind = 'deposit' and status = 'confirmed'), 0)::text as deposits,
        coalesce(sum(amount) filter (where kind = 'daily_reward' and status = 'confirmed'), 0)::text as earnings,
        greatest(0,
          coalesce(sum(amount) filter (where kind in ('deposit', 'daily_reward') and status = 'confirmed'), 0)
          + coalesce(sum(amount) filter (where kind = 'ledger_adjustment' and adjustment_direction = 'credit' and status = 'confirmed'), 0)
          - coalesce(sum(amount) filter (where kind = 'ledger_adjustment' and adjustment_direction = 'debit' and status = 'confirmed'), 0)
          - coalesce(sum(amount) filter (where kind = 'withdrawal' and status in ('pending', 'cancel_requested', 'paid')), 0))::text as available
      from wallet_transactions group by user_id
    ), referral_counts as (
      select referrer_id, count(*)::int as direct_count from referrals where referred_user_id is not null group by referrer_id
    )
    select u.id, u.email, u.display_name as name, u.referral_code as "referralCode", u.created_at as "createdAt",
      coalesce(b.deposits, '0') as deposits, coalesce(b.earnings, '0') as earnings,
      coalesce(b.available, '0') as available, coalesce(rc.direct_count, 0) as "directReferrals",
      m.tier_key as "membershipTier", m.status as "membershipStatus"
    from users u left join balances b on b.user_id = u.id
    left join referral_counts rc on rc.referrer_id = u.id
    left join user_memberships m on m.user_id = u.id
    order by u.created_at desc limit 500`),
    pool.query(`select r.id, r.status, r.created_at as "createdAt", a.email as "referrerEmail", b.email as "referredEmail", a.referral_code as "referrerCode"
      from referrals r join users a on a.id = r.referrer_id
      left join users b on b.id = r.referred_user_id order by r.created_at desc limit 500`),
    pool.query(`select t.id, t.user_id as "userId", u.email, u.display_name as "userName", t.kind, t.tier_key as "tierKey", t.amount::text,
      t.status, t.tx_hash as "txHash", t.wallet_address as "walletAddress", t.note, t.request_reason as "requestReason",
      t.cancellation_reason as "cancellationReason", t.review_reason as "reviewReason", t.cancellation_review_reason as "cancellationReviewReason",
      t.adjustment_direction as direction, (t.proof_image_data_url is not null) as "proofAvailable",
      t.created_at as "createdAt", t.reviewed_at as "reviewedAt", reviewer.email as "reviewerEmail"
      from wallet_transactions t join users u on u.id = t.user_id
      left join users reviewer on reviewer.id = t.reviewed_by
      order by (t.status = 'pending') desc, t.created_at desc limit 500`),
  ]);
  res.json({ data: { config: config.rows[0] ?? { network: '', depositAddress: '', depositQr: '' }, users: users.rows, transactions: transactions.rows, referrals: referrals.rows } });
}));

const adminUserUpdateSchema = z.object({
  email: z.string().email().max(254).transform((value) => value.trim().toLowerCase()),
  name: z.string().trim().min(1).max(80),
});
app.patch('/api/v1/admin/users/:id', requireUser, requireAdmin, asyncRoute(async (req, res) => {
  if (!z.string().uuid().safeParse(req.params.id).success) return res.status(400).json({ error: 'Invalid user ID.' });
  const parsed = adminUserUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Enter a valid email and display name.' });
  const client = await pool.connect();
  try {
    await client.query('begin');
    const updated = await client.query("update users set email = $1, display_name = $2 where id = $3 and role = 'member' returning id, email, display_name as name", [parsed.data.email, parsed.data.name, req.params.id]);
    if (!updated.rows[0]) { await client.query('rollback'); return res.status(404).json({ error: 'Member account not found.' }); }
    await client.query('insert into admin_audit_log (admin_user_id, target_user_id, action, details) values ($1, $2, $3, $4)', [req.userId, req.params.id, 'member_updated', JSON.stringify({ email: parsed.data.email, name: parsed.data.name })]);
    await client.query('commit');
    res.json({ data: updated.rows[0] });
  } catch (error) {
    await client.query('rollback');
    if ((error as { code?: string }).code === '23505') return res.status(409).json({ error: 'Another account already uses that email address.' });
    throw error;
  } finally { client.release(); }
}));

const adminPasswordResetSchema = z.object({ newPassword: z.string().min(8).max(128) });
app.patch('/api/v1/admin/users/:id/password', requireUser, requireAdmin, asyncRoute(async (req, res) => {
  if (!z.string().uuid().safeParse(req.params.id).success) return res.status(400).json({ error: 'Invalid user ID.' });
  const parsed = adminPasswordResetSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Set a new password with at least 8 characters.' });
  const passwordHash = await bcrypt.hash(parsed.data.newPassword, 12);
  const client = await pool.connect();
  try {
    await client.query('begin');
    const updated = await client.query("update users set password_hash = $1, token_version = token_version + 1 where id = $2 and role = 'member' returning id, email", [passwordHash, req.params.id]);
    if (!updated.rows[0]) { await client.query('rollback'); return res.status(404).json({ error: 'Member account not found.' }); }
    await client.query('insert into admin_audit_log (admin_user_id, target_user_id, action, details) values ($1, $2, $3, $4)', [req.userId, req.params.id, 'member_password_reset', JSON.stringify({ email: updated.rows[0].email, sessionsRevoked: true })]);
    await client.query('commit');
    res.json({ notice: 'Password updated. Existing sessions were revoked; share the new password with the member securely.' });
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally { client.release(); }
}));

const adminLedgerAdjustmentSchema = z.object({ direction: z.enum(['credit', 'debit']), amount: z.coerce.number().positive().max(1_000_000_000), reason: z.string().trim().min(3).max(500) });
app.post('/api/v1/admin/users/:id/ledger-adjustments', requireUser, requireAdmin, asyncRoute(async (req, res) => {
  if (!z.string().uuid().safeParse(req.params.id).success) return res.status(400).json({ error: 'Invalid user ID.' });
  const parsed = adminLedgerAdjustmentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Enter a positive amount and an adjustment reason.' });
  const client = await pool.connect();
  try {
    await client.query('begin');
    const target = await client.query("select id from users where id = $1 and role = 'member' for update", [req.params.id]);
    if (!target.rows[0]) { await client.query('rollback'); return res.status(404).json({ error: 'Member account not found.' }); }
    if (parsed.data.direction === 'debit') {
      const balance = await client.query(`select greatest(0,
        coalesce(sum(amount) filter (where kind in ('deposit', 'daily_reward') and status = 'confirmed'), 0)
        + coalesce(sum(amount) filter (where kind = 'ledger_adjustment' and adjustment_direction = 'credit' and status = 'confirmed'), 0)
        - coalesce(sum(amount) filter (where kind = 'ledger_adjustment' and adjustment_direction = 'debit' and status = 'confirmed'), 0)
        - coalesce(sum(amount) filter (where kind = 'withdrawal' and status in ('pending', 'cancel_requested', 'paid')), 0)) as available
        from wallet_transactions where user_id = $1`, [req.params.id]);
      if (Number(balance.rows[0].available) < parsed.data.amount) { await client.query('rollback'); return res.status(400).json({ error: 'A debit adjustment cannot exceed the member’s withdrawable balance.' }); }
    }
    const created = await client.query(`insert into wallet_transactions (user_id, kind, adjustment_direction, amount, status, note, reviewed_by, reviewed_at)
      values ($1, 'ledger_adjustment', $2, $3, 'confirmed', $4, $5, now())
      returning id, user_id as "userId", kind, adjustment_direction as direction, amount::text, status, note, created_at as "createdAt"`,
    [req.params.id, parsed.data.direction, parsed.data.amount, parsed.data.reason, req.userId]);
    await client.query('insert into admin_audit_log (admin_user_id, target_user_id, action, details) values ($1, $2, $3, $4)', [req.userId, req.params.id, 'ledger_adjustment', JSON.stringify({ direction: parsed.data.direction, amount: parsed.data.amount, reason: parsed.data.reason })]);
    await client.query('commit');
    res.status(201).json({ data: created.rows[0] });
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally { client.release(); }
}));

app.get('/api/v1/admin/wallet-transactions/:id/proof', requireUser, requireAdmin, asyncRoute(async (req, res) => {
  const proof = await pool.query("select proof_image_data_url as \"proofImage\" from wallet_transactions where id = $1 and kind = 'deposit'", [req.params.id]);
  if (!proof.rows[0]?.proofImage) return res.status(404).json({ error: 'This deposit has no payment screenshot attached.' });
  res.json({ data: { proofImage: proof.rows[0].proofImage } });
}));

const walletConfigSchema = z.object({
  network: z.string().trim().min(1).max(60),
  depositAddress: z.string().trim().min(8).max(200),
  depositQr: z.string().max(2_000_000).refine((value) => !value || /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value), 'QR must be a PNG, JPEG, or WebP image.'),
});
app.put('/api/v1/admin/wallet-config', requireUser, requireAdmin, asyncRoute(async (req, res) => {
  const parsed = walletConfigSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Enter a supported network, deposit address, and valid QR image.' });
  const { rows } = await pool.query(`update platform_wallet_config set usdt_network = $1, deposit_address = $2,
    deposit_qr_data_url = $3, updated_by = $4, updated_at = now() where id = 1
    returning usdt_network as network, deposit_address as "depositAddress", deposit_qr_data_url as "depositQr", updated_at as "updatedAt"`,
  [parsed.data.network, parsed.data.depositAddress, parsed.data.depositQr, req.userId]);
  res.json({ data: rows[0] });
}));

const transactionReviewSchema = z.object({ action: z.enum(['confirm_deposit', 'confirm_reward', 'pay_withdrawal', 'reject', 'approve_cancellation', 'deny_cancellation']), txHash: z.string().trim().min(16).max(200).optional(), reviewReason: z.string().trim().min(3).max(500).optional() });
app.patch('/api/v1/admin/wallet-transactions/:id', requireUser, requireAdmin, asyncRoute(async (req, res) => {
  const parsed = transactionReviewSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Choose a valid review action.' });
  if (parsed.data.action === 'pay_withdrawal' && !parsed.data.txHash) return res.status(400).json({ error: 'Enter the on-chain transaction hash after sending the withdrawal.' });
  if (['reject', 'deny_cancellation'].includes(parsed.data.action) && !parsed.data.reviewReason) return res.status(400).json({ error: 'Enter a reason for refusing this request.' });
  const client = await pool.connect();
  try {
    await client.query('begin');
    const current = await client.query('select id, user_id, kind, tier_key, amount, status from wallet_transactions where id = $1 for update', [req.params.id]);
    if (!current.rows[0]) { await client.query('rollback'); return res.status(404).json({ error: 'Transaction not found.' }); }
    const { action, txHash, reviewReason } = parsed.data;
    const expectedStatus = action === 'approve_cancellation' || action === 'deny_cancellation' ? 'cancel_requested' : 'pending';
    if (current.rows[0].status !== expectedStatus) { await client.query('rollback'); return res.status(409).json({ error: 'This transaction is no longer awaiting this review action.' }); }
    if (action === 'confirm_deposit' && current.rows[0].kind !== 'deposit') { await client.query('rollback'); return res.status(400).json({ error: 'Only deposit requests can be confirmed.' }); }
    if (action === 'confirm_reward' && current.rows[0].kind !== 'daily_reward') { await client.query('rollback'); return res.status(400).json({ error: 'Only daily reward requests can be confirmed.' }); }
    if (action === 'confirm_reward') {
      const latest = await client.query("select max(coalesce(reviewed_at, created_at)) as collected_at from wallet_transactions where user_id = $1 and kind = 'daily_reward' and status = 'confirmed'", [current.rows[0].user_id]);
      const availableAt = latest.rows[0].collected_at ? new Date(new Date(latest.rows[0].collected_at).getTime() + 24 * 60 * 60 * 1000) : null;
      if (availableAt && availableAt.getTime() > Date.now()) { await client.query('rollback'); return res.status(409).json({ error: `Reward cannot be approved until ${availableAt.toISOString()} (24 hours after the previous collection).` }); }
    }
    if (action === 'pay_withdrawal' && current.rows[0].kind !== 'withdrawal') { await client.query('rollback'); return res.status(400).json({ error: 'Only withdrawal requests can be marked paid.' }); }
    if (['approve_cancellation', 'deny_cancellation'].includes(action) && current.rows[0].kind !== 'withdrawal') { await client.query('rollback'); return res.status(400).json({ error: 'Only withdrawal requests can be cancelled.' }); }
    if (action === 'reject' && !['deposit', 'withdrawal', 'daily_reward'].includes(current.rows[0].kind)) { await client.query('rollback'); return res.status(400).json({ error: 'This transaction cannot be rejected.' }); }
    if (action === 'confirm_deposit' && !current.rows[0].tier_key) { await client.query('rollback'); return res.status(409).json({ error: 'This deposit is missing its membership tier.' }); }
    if (action === 'pay_withdrawal' && !parsed.data.txHash) { await client.query('rollback'); return res.status(400).json({ error: 'Enter the on-chain transaction hash after sending the withdrawal.' }); }
    const status = action === 'confirm_deposit' || action === 'confirm_reward' ? 'confirmed' : action === 'pay_withdrawal' ? 'paid' : action === 'approve_cancellation' ? 'cancelled' : action === 'deny_cancellation' ? 'pending' : 'rejected';
    const { rows } = await client.query(`update wallet_transactions set status = $1, tx_hash = case when $2 <> '' then $2 else tx_hash end,
      review_reason = case when $6 = 'reject' and $3 <> '' then $3 else review_reason end,
      cancellation_review_reason = case when $6 = 'deny_cancellation' and $3 <> '' then $3 else cancellation_review_reason end,
      reviewed_by = $4, reviewed_at = now()
      where id = $5 returning id, kind, amount::text, status, tx_hash as "txHash", review_reason as "reviewReason", cancellation_review_reason as "cancellationReviewReason"`,
    [status, txHash ?? '', reviewReason ?? '', req.userId, req.params.id, action]);
    if (action === 'confirm_deposit') await client.query("update user_memberships set tier_key = $1, status = 'active', deposit_amount = $2 where user_id = $3",
      [current.rows[0].tier_key, current.rows[0].amount, current.rows[0].user_id]);
    await client.query('commit');
    res.json({ data: rows[0] });
  } catch (error) {
    await client.query('rollback');
    if ((error as { code?: string }).code === '23505') return res.status(409).json({ error: 'That transaction hash is already recorded.' });
    throw error;
  }
  finally { client.release(); }
}));

app.get('/api/v1/dashboard', requireUser, asyncRoute(async (req, res) => {
  const [profile, trades, membership, wallet] = await Promise.all([
    pool.query('select display_name, referral_code from users where id = $1', [req.userId]),
    pool.query('select id, symbol, side, quantity, price, created_at from paper_trades where user_id = $1 order by created_at desc limit 20', [req.userId]),
    pool.query('select tier_key, status, deposit_amount::text as deposit_amount from user_memberships where user_id = $1', [req.userId]),
    pool.query(`select
      coalesce(sum(amount) filter (where kind = 'deposit' and status = 'confirmed'), 0)::text as "depositTotal",
      coalesce(sum(amount) filter (where kind = 'daily_reward' and status = 'confirmed'), 0)::text as "earningsTotal",
      greatest(0,
        coalesce(sum(amount) filter (where kind in ('deposit', 'daily_reward') and status = 'confirmed'), 0)
        + coalesce(sum(amount) filter (where kind = 'ledger_adjustment' and adjustment_direction = 'credit' and status = 'confirmed'), 0)
        - coalesce(sum(amount) filter (where kind = 'ledger_adjustment' and adjustment_direction = 'debit' and status = 'confirmed'), 0)
        - coalesce(sum(amount) filter (where kind = 'withdrawal' and status in ('pending', 'cancel_requested', 'paid')), 0))::text as "availableBalance"
      from wallet_transactions where user_id = $1`, [req.userId]),
  ]);
  res.json({ data: {
    profile: profile.rows[0] ?? null, markets: demoMarkets, trades: trades.rows,
    membership: membership.rows[0] ?? { tier_key: 'starter', status: 'demo' },
    wallet: wallet.rows[0],
  } });
}));

app.get('/api/v1/trades', requireUser, asyncRoute(async (req, res) => {
  const { rows } = await pool.query('select id, symbol, side, quantity, price, created_at from paper_trades where user_id = $1 order by created_at desc limit 100', [req.userId]);
  res.json({ data: rows });
}));

const tradeInput = z.object({ symbol: z.enum(['BTC', 'ETH', 'SOL', 'BNB']), side: z.enum(['buy', 'sell']), quantity: z.number().positive().max(1000) });
app.post('/api/v1/trades', requireUser, asyncRoute(async (req, res) => {
  const parsed = tradeInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Enter a supported asset and a positive quantity.' });
  const market = demoMarkets.find((item) => item.symbol === parsed.data.symbol)!;
  const { rows } = await pool.query(
    'insert into paper_trades (user_id, symbol, side, quantity, price) values ($1, $2, $3, $4, $5) returning id, symbol, side, quantity, price, created_at',
    [req.userId, parsed.data.symbol, parsed.data.side, parsed.data.quantity, market.price],
  );
  res.status(201).json({ data: rows[0], notice: 'Paper trade recorded. No real asset was bought or sold.' });
}));

const profileSettingsSchema = z.object({ displayName: z.string().trim().min(1).max(80) });
app.get('/api/v1/settings', requireUser, asyncRoute(async (req, res) => {
  const { rows } = await pool.query('select id, email, display_name as "displayName" from users where id = $1', [req.userId]);
  if (!rows[0]) return res.status(404).json({ error: 'Account not found.' });
  res.json({ data: rows[0] });
}));
app.patch('/api/v1/settings', requireUser, asyncRoute(async (req, res) => {
  const parsed = profileSettingsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Enter a display name between 1 and 80 characters.' });
  const { rows } = await pool.query('update users set display_name = $1 where id = $2 returning id, email, display_name as "displayName"', [parsed.data.displayName, req.userId]);
  if (!rows[0]) return res.status(404).json({ error: 'Account not found.' });
  res.json({ data: rows[0] });
}));
const passwordSettingsSchema = z.object({ currentPassword: z.string().min(6).max(128), newPassword: z.string().min(8).max(128) });
app.patch('/api/v1/settings/password', requireUser, asyncRoute(async (req, res) => {
  const parsed = passwordSettingsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Enter your current password and choose a new password with at least 8 characters.' });
  const current = await pool.query('select password_hash from users where id = $1', [req.userId]);
  if (!current.rows[0] || !(await bcrypt.compare(parsed.data.currentPassword, current.rows[0].password_hash))) return res.status(400).json({ error: 'Current password is incorrect.' });
  const passwordHash = await bcrypt.hash(parsed.data.newPassword, 12);
  await pool.query('update users set password_hash = $1 where id = $2', [passwordHash, req.userId]);
  res.json({ message: 'Password updated.' });
}));

app.get('/api/v1/wallet', requireUser, asyncRoute(async (req, res) => {
  const [settings, summary, transactions, rewardState] = await Promise.all([
    pool.query('select usdt_network as network, deposit_address as "depositAddress", deposit_qr_data_url as "depositQr" from platform_wallet_config where id = 1'),
    pool.query(`select
      coalesce(sum(amount) filter (where kind = 'deposit' and status = 'confirmed'), 0)::text as "depositTotal",
      coalesce(sum(amount) filter (where kind = 'daily_reward' and status = 'confirmed'), 0)::text as "earningsTotal",
      greatest(0,
        coalesce(sum(amount) filter (where kind in ('deposit', 'daily_reward') and status = 'confirmed'), 0)
        + coalesce(sum(amount) filter (where kind = 'ledger_adjustment' and adjustment_direction = 'credit' and status = 'confirmed'), 0)
        - coalesce(sum(amount) filter (where kind = 'ledger_adjustment' and adjustment_direction = 'debit' and status = 'confirmed'), 0)
        - coalesce(sum(amount) filter (where kind = 'withdrawal' and status in ('pending', 'cancel_requested', 'paid')), 0))::text as "availableBalance"
      from wallet_transactions where user_id = $1`, [req.userId]),
    pool.query('select id, kind, adjustment_direction as direction, amount::text, status, tx_hash as "txHash", wallet_address as "walletAddress", note, request_reason as "requestReason", cancellation_reason as "cancellationReason", review_reason as "reviewReason", cancellation_review_reason as "cancellationReviewReason", created_at as "createdAt", reviewed_at as "reviewedAt" from wallet_transactions where user_id = $1 order by created_at desc limit 500', [req.userId]),
    pool.query(`select m.status as "membershipStatus", m.deposit_amount::text as "depositAmount",
      (m.deposit_amount * 0.001)::text as "rewardAmount",
      (select max(coalesce(t.reviewed_at, t.created_at)) from wallet_transactions t where t.user_id = m.user_id and t.kind = 'daily_reward' and t.status = 'confirmed') as "lastCollectedAt",
      exists(select 1 from wallet_transactions t where t.user_id = m.user_id and t.kind = 'daily_reward' and t.status = 'pending') as "pendingRequest"
      from user_memberships m where m.user_id = $1`, [req.userId]),
  ]);
  const reward = rewardState.rows[0] ?? null;
  const nextAvailableAt = reward?.lastCollectedAt ? new Date(new Date(reward.lastCollectedAt).getTime() + 24 * 60 * 60 * 1000).toISOString() : null;
  const canClaim = reward?.membershipStatus === 'active' && !reward.pendingRequest && (!nextAvailableAt || new Date(nextAvailableAt).getTime() <= Date.now());
  res.json({ data: { config: settings.rows[0] ?? { network: '', depositAddress: '', depositQr: '' }, summary: summary.rows[0], transactions: transactions.rows, reward: reward ? { ...reward, nextAvailableAt, canClaim } : null } });
}));

const depositSchema = z.object({ tierKey: z.enum(['starter', 'growth', 'pro']).optional(), amount: z.coerce.number().min(10).max(1_000_000_000), txHash: z.string().trim().min(16).max(200), proofImage: z.string().max(1_700_000).refine((value) => /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value), 'Screenshot must be a PNG, JPEG, or WebP image.').optional(), note: z.string().trim().max(500).optional() });
app.post('/api/v1/wallet/deposits', requireUser, asyncRoute(async (req, res) => {
  const parsed = depositSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Enter at least 10 USDT and provide the transaction hash.' });
  const tierKey = parsed.data.amount >= 500 ? 'pro' : parsed.data.amount >= 100 ? 'growth' : 'starter';
  const config = await pool.query('select usdt_network, deposit_address from platform_wallet_config where id = 1');
  if (!config.rows[0]?.usdt_network || !config.rows[0]?.deposit_address) return res.status(503).json({ error: 'USDT deposit details are not configured by the administrator yet.' });
  const member = await pool.query("select status from user_memberships where user_id = $1", [req.userId]);
  if (member.rows[0]?.status === 'active') return res.status(409).json({ error: 'This account already has an active membership.' });
  try {
    const { rows } = await pool.query(`insert into wallet_transactions (user_id, kind, tier_key, amount, status, tx_hash, note, proof_image_data_url)
      values ($1, 'deposit', $2, $3, 'pending', $4, $5, $6)
      returning id, kind, tier_key as "tierKey", amount::text, status, tx_hash as "txHash", created_at as "createdAt"`,
    [req.userId, tierKey, parsed.data.amount, parsed.data.txHash, parsed.data.note ?? '', parsed.data.proofImage ?? null]);
    return res.status(201).json({ data: rows[0], notice: 'Deposit submitted for manual administrator review. It is not credited until confirmed.' });
  } catch (error) {
    if ((error as { code?: string }).code === '23505') return res.status(409).json({ error: 'This transaction hash or a pending deposit has already been submitted.' });
    throw error;
  }
}));

const withdrawalSchema = z.object({ amount: z.coerce.number().positive().max(1_000_000_000), walletAddress: z.string().trim().min(8).max(200), reason: z.string().trim().min(3).max(500) });
app.post('/api/v1/wallet/withdrawals', requireUser, asyncRoute(async (req, res) => {
  const parsed = withdrawalSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Enter a positive amount, destination wallet address, and withdrawal reason.' });
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query('select id from users where id = $1 for update', [req.userId]);
    const balance = await client.query(`select
      greatest(0,
        coalesce(sum(amount) filter (where kind in ('deposit', 'daily_reward') and status = 'confirmed'), 0)
        + coalesce(sum(amount) filter (where kind = 'ledger_adjustment' and adjustment_direction = 'credit' and status = 'confirmed'), 0)
        - coalesce(sum(amount) filter (where kind = 'ledger_adjustment' and adjustment_direction = 'debit' and status = 'confirmed'), 0)
        - coalesce(sum(amount) filter (where kind = 'withdrawal' and status in ('pending', 'cancel_requested', 'paid')), 0)) as available
      from wallet_transactions where user_id = $1`, [req.userId]);
    if (Number(balance.rows[0].available) < parsed.data.amount) {
      await client.query('rollback');
      return res.status(400).json({ error: 'The requested withdrawal exceeds your available balance.' });
    }
    const { rows } = await client.query(`insert into wallet_transactions (user_id, kind, amount, status, wallet_address, note, request_reason)
      values ($1, 'withdrawal', $2, 'pending', $3, $4, $5)
      returning id, kind, amount::text, status, wallet_address as "walletAddress", created_at as "createdAt"`,
    [req.userId, parsed.data.amount, parsed.data.walletAddress, parsed.data.reason, parsed.data.reason]);
    await client.query('commit');
    res.status(201).json({ data: rows[0], notice: 'Withdrawal request sent to the administrator. The amount is reserved while it is reviewed.' });
  } catch (error) { await client.query('rollback'); throw error; }
  finally { client.release(); }
}));

const withdrawalCancellationSchema = z.object({ reason: z.string().trim().min(3).max(500) });
app.patch('/api/v1/wallet/withdrawals/:id/cancel', requireUser, asyncRoute(async (req, res) => {
  if (!z.string().uuid().safeParse(req.params.id).success) return res.status(400).json({ error: 'Invalid withdrawal request ID.' });
  const parsed = withdrawalCancellationSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Enter a reason for the cancellation request.' });
  const client = await pool.connect();
  try {
    await client.query('begin');
    const current = await client.query('select id, kind, status from wallet_transactions where id = $1 and user_id = $2 for update', [req.params.id, req.userId]);
    if (!current.rows[0]) { await client.query('rollback'); return res.status(404).json({ error: 'Withdrawal request not found.' }); }
    if (current.rows[0].kind !== 'withdrawal' || current.rows[0].status !== 'pending') { await client.query('rollback'); return res.status(409).json({ error: 'Only pending withdrawals can be cancelled.' }); }
    const { rows } = await client.query(`update wallet_transactions set status = 'cancel_requested', cancellation_reason = $1,
      cancellation_review_reason = '', reviewed_by = null, reviewed_at = null where id = $2
      returning id, status, cancellation_reason as "cancellationReason"`, [parsed.data.reason, req.params.id]);
    await client.query('commit');
    res.json({ data: rows[0], notice: 'Cancellation request sent to the administrator. The amount stays reserved until they review it.' });
  } catch (error) { await client.query('rollback'); throw error; }
  finally { client.release(); }
}));

app.post('/api/v1/wallet/rewards/claim', requireUser, asyncRoute(async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const member = await client.query("select tier_key, status, deposit_amount::text as deposit_amount from user_memberships where user_id = $1 for update", [req.userId]);
    const activeMembership = member.rows[0];
    if (activeMembership?.status !== 'active' || Number(activeMembership.deposit_amount) <= 0) { await client.query('rollback'); return res.status(403).json({ error: 'An active, deposit-confirmed membership is required to collect a daily reward.' }); }
    const recent = await client.query(`select max(coalesce(reviewed_at, created_at)) as "lastCollectedAt",
      exists(select 1 from wallet_transactions where user_id = $1 and kind = 'daily_reward' and status = 'pending') as pending
      from wallet_transactions where user_id = $1 and kind = 'daily_reward' and status = 'confirmed'`, [req.userId]);
    if (recent.rows[0].pending) { await client.query('rollback'); return res.status(409).json({ error: 'A previous reward request is still pending. Contact the administrator for help.' }); }
    const lastCollectedAt = recent.rows[0].lastCollectedAt;
    const nextAvailableAt = lastCollectedAt ? new Date(new Date(lastCollectedAt).getTime() + 24 * 60 * 60 * 1000) : null;
    if (nextAvailableAt && nextAvailableAt.getTime() > Date.now()) { await client.query('rollback'); return res.status(409).json({ error: `Your next reward is available after ${nextAvailableAt.toISOString()}.` }); }
    const rewardAmount = Number(activeMembership.deposit_amount) * 0.001;
    const { rows } = await client.query(`insert into wallet_transactions (user_id, kind, amount, status, note, reviewed_at)
      values ($1, 'daily_reward', $2, 'confirmed', 'Daily reward collected · 0.1% of confirmed membership deposit', now())
      returning id, kind, amount::text, status, created_at as "createdAt", reviewed_at as "collectedAt"`, [req.userId, rewardAmount]);
    await client.query('commit');
    res.status(201).json({ data: rows[0], notice: `${rewardAmount.toFixed(2)} USDT has been added to your earnings wallet. Your next reward is available in 24 hours.` });
  } catch (error) {
    await client.query('rollback');
    if ((error as { code?: string }).code === '23505') return res.status(409).json({ error: 'A previous reward request is still pending. Contact the administrator for help.' });
    throw error;
  } finally { client.release(); }
}));

app.get('/api/v1/referrals', requireUser, asyncRoute(async (req, res) => {
  const [profile, referrals] = await Promise.all([
    pool.query('select referral_code from users where id = $1', [req.userId]),
    pool.query(`
      with recursive network as (
        select r.id as referral_id, r.referrer_id, r.referred_user_id, r.status, r.created_at,
          1 as level, array[r.referrer_id, r.referred_user_id]::uuid[] as path
        from referrals r
        where r.referrer_id = $1 and r.referred_user_id is not null
        union all
        select r.id, r.referrer_id, r.referred_user_id, r.status, r.created_at,
          n.level + 1, n.path || r.referred_user_id
        from referrals r
        join network n on n.referred_user_id = r.referrer_id
        where r.referred_user_id is not null and n.level < 20
          and not r.referred_user_id = any(n.path)
      )
      select n.referral_id, n.referrer_id, n.referred_user_id as id,
        u.display_name as name, u.referral_code as code, n.status, n.created_at, n.level
      from network n join users u on u.id = n.referred_user_id
      order by n.level, n.created_at desc
    `, [req.userId]),
  ]);
  const tree = referrals.rows;
  res.json({ data: {
    code: profile.rows[0]?.referral_code ?? null,
    directCount: tree.filter((referral) => referral.level === 1).length,
    networkCount: tree.length,
    referrals: tree,
    commissions: { enabled: false, total: 0 },
  } });
}));

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong while handling the request.' });
});

const port = Number(process.env.API_PORT ?? 4000);
app.listen(port, '0.0.0.0', () => console.log(`Trade Market API listening on port ${port}`));


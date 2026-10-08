'use client';

import { FormEvent, Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, ArrowUpRight, Command, ShieldCheck } from 'lucide-react';
import { apiRequest, AuthResponse, saveSession } from '@/lib/api';

function AuthForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<'signin'|'signup'>(searchParams.get('mode') === 'signup' ? 'signup' : 'signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [referralCode, setReferralCode] = useState(() => searchParams.get('ref') ?? '');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault(); setMessage(''); setBusy(true);
    try {
      const result = await apiRequest<AuthResponse>(mode === 'signup' ? '/auth/register' : '/auth/login', {
        method: 'POST', body: JSON.stringify({ email, password, ...(mode === 'signup' && referralCode.trim() ? { referralCode: referralCode.trim() } : {}) }),
      });
      saveSession(result);
      const next = searchParams.get('next');
      router.push(next?.startsWith('/') && !next.startsWith('//') ? next : '/dashboard');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not sign in.'); }
    setBusy(false);
  }

  return <main className="auth-shell"><div className="auth-decoration"><span className="auth-ring ring-one"/><span className="auth-ring ring-two"/><span className="auth-orbit"><Command size={27}/></span><div className="auth-decoration-copy"><span>TRADE MARKET</span><h2>Clarity for<br/>your next move.</h2><p>Explore markets. Practice at your pace.</p></div></div><section className="auth-side"><Link href="/" className="auth-back"><ArrowLeft size={15}/> Back to home</Link><form className="auth-form" onSubmit={submit}><Link href="/" className="brand auth-brand"><span className="brand-mark"><Command size={20}/></span><span>trade<span className="brand-accent">market</span><small>SMARTER MARKETS</small></span></Link><div className="landing-eyebrow">YOUR WORKSPACE</div><h1>{mode === 'signin' ? 'Welcome back' : 'Create your account'}</h1><p>{mode === 'signin' ? 'Sign in to access your dashboard and saved paper trades.' : 'Create an account to keep your practice activity in one place.'}</p><label>Email address<input required type="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={e=>setEmail(e.target.value)}/></label><label>Password<input required minLength={6} type="password" autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} placeholder="At least 6 characters" value={password} onChange={e=>setPassword(e.target.value)}/></label>{mode === 'signup' && <label>Referral code <span className="auth-optional">Optional</span><input type="text" autoComplete="off" placeholder="Enter a referral code" value={referralCode} onChange={e=>setReferralCode(e.target.value.toUpperCase())}/></label>}{message&&<div className="auth-error">{message}</div>}<button className="landing-cta auth-submit" disabled={busy}>{busy?'Please wait…':mode==='signin'?'Sign in':'Create account'} <ArrowUpRight size={15}/></button><div className="auth-toggle">{mode==='signin'?"Don't have an account?":"Already registered?"}<button type="button" onClick={()=>{setMode(mode==='signin'?'signup':'signin');setMessage('')}}>{mode==='signin'?'Create account':'Sign in'}</button></div><div className="auth-security"><ShieldCheck size={14}/> Authentication managed by the Trade Market API</div></form></section></main>;
}

export default function AuthPage() { return <Suspense fallback={<main className="auth-shell"><section className="auth-side">Loading…</section></main>}><AuthForm/></Suspense>; }

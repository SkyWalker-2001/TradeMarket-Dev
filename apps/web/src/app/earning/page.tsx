import Link from 'next/link';
import { ArrowLeft, ArrowUpRight, CalendarDays, Command, ShieldCheck, Wallet } from 'lucide-react';

const steps = [
  { number: '01', title: 'Choose a membership', description: 'Select Starter, Growth, or Pro and review its USDT deposit amount before you continue.' },
  { number: '02', title: 'Confirm your deposit', description: 'Once a supported network and payment provider are connected, the deposit must be confirmed before a membership activates.' },
  { number: '03', title: 'Wait 24 hours', description: 'After collecting a reward, a rolling 24-hour timer starts before the next reward is available.' },
  { number: '04', title: 'Collect to your wallet', description: 'Collect 0.1% of your confirmed membership deposit. It is credited to your earnings wallet immediately.' },
];

export default function EarningPage() {
  return <main className="landing-shell earning-shell">
    <header className="landing-nav"><Link href="/" className="brand"><span className="brand-mark"><Command size={20} /></span><span>trade<span className="brand-accent">market</span><small>SMARTER MARKETS</small></span></Link><nav><Link href="/">Home</Link><Link href="/#membership">Membership</Link><Link href="/#how-it-works">How it works</Link></nav><div className="landing-actions"><Link href="/auth" className="landing-signin">Sign in</Link><Link href="/auth?mode=signup" className="landing-cta">Get started <ArrowUpRight size={15} /></Link></div></header>

    <section className="earning-hero"><Link href="/" className="earning-back"><ArrowLeft size={13}/> Back to home</Link><div className="landing-eyebrow"><span /> MEMBERSHIP &amp; REWARDS</div><h1>Understand how rewards work.</h1><p>Activate a membership with a confirmed deposit, collect its eligible daily reward, and request a withdrawal from your wallet.</p><div className="earning-status"><span className="earning-status-dot"/><span><b>24-hour collection cycle</b><small>Membership deposits are manually verified. Collected rewards are credited immediately; withdrawal requests are reviewed by an administrator.</small></span></div></section>

    <section className="earning-steps"><div className="landing-section-title"><span className="landing-eyebrow">THE MEMBERSHIP JOURNEY</span><h2>Four steps, with clear terms.</h2><p>Requested membership deposits and estimated daily reward amounts.</p></div><div className="earning-plan-grid">{[{name:'Starter',deposit:10},{name:'Growth',deposit:100},{name:'Pro',deposit:500}].map(({name,deposit}) => <article key={name}><span className="earning-plan-tier">{name}</span><b>{deposit} USDT</b><small>Membership deposit</small><div className="earning-plan-rule">0.1% daily <strong>{(deposit * 0.001).toFixed(2)} USDT</strong></div></article>)}</div><div className="earning-step-grid">{steps.map((step) => <article key={step.number}><span className="workflow-step">{step.number}</span><h3>{step.title}</h3><p>{step.description}</p></article>)}</div></section>

    <section className="earning-detail-grid"><article className="earning-detail-card"><span className="feature-icon amber"><Wallet size={19}/></span><h2>Membership plans</h2><p>Starter is 10 USDT, Growth is 100 USDT, and Pro is 500 USDT. The listed tier deposit is submitted for manual verification before membership activation.</p><Link href="/dashboard" className="earning-inline-link">View membership options <ArrowUpRight size={13}/></Link></article><article className="earning-detail-card"><span className="feature-icon green"><CalendarDays size={19}/></span><h2>Daily rewards</h2><p>Collect 0.1% of the confirmed membership deposit once every 24 hours. Each collection is credited to the earnings wallet immediately and resets the 24-hour timer.</p><Link href="/auth" className="earning-inline-link">Sign in to collect rewards <ArrowUpRight size={13}/></Link></article></section>

    <div className="program-note earning-disclaimer"><span className="program-note-icon"><ShieldCheck size={16}/></span><p><b>Deposits and withdrawals are manually reviewed.</b> Membership deposits are credited after administrator verification. Daily reward collections are credited to the earnings wallet immediately. Withdrawal transfers are handled by the administrator outside the app and recorded with a transaction hash.</p></div>

    <section className="landing-bottom earning-bottom"><div><span className="landing-eyebrow">EXPLORE THE DEMO</span><h2>See the workspace first.</h2><p>Membership and wallet requests are managed from the dashboard with manual administrator review.</p></div><Link href="/dashboard" className="landing-cta">Open dashboard <ArrowUpRight size={15}/></Link></section>
    <footer className="landing-footer"><Link href="/" className="brand"><span className="brand-mark"><Command size={18}/></span><span>trade<span className="brand-accent">market</span></span></Link><span>Membership · Manual USDT review</span><span><Link href="/auth">Account</Link><Link href="/admin">Admin</Link></span></footer>
  </main>;
}


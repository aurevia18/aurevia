'use client';
import Link from 'next/link';
import Image from 'next/image';
import {useSession,signOut} from 'next-auth/react';
import {usePathname,useRouter} from 'next/navigation';
import {LogOut,LayoutDashboard,LineChart,Wallet,ShieldCheck,Settings,Menu,X,PhoneCall,Mail,Radio,BriefcaseBusiness,History} from 'lucide-react';
import {useEffect,useState} from 'react';
import NotificationBell from '@/components/NotificationBell';
import LanguageSelector from '@/components/LanguageSelector';
import {useLocale} from '@/lib/i18n-context';

export default function Nav(){
 const {data,status,update}=useSession(); const pathname=usePathname(); const router=useRouter(); const {translate}=useLocale(); const [open,setOpen]=useState(false); const [modeError,setModeError]=useState(''); const [modeBusy,setModeBusy]=useState(false); const [loggingOut,setLoggingOut]=useState(false);
 const close=()=>setOpen(false);
 const active=(href:string)=>pathname===href||pathname.startsWith(`${href}/`);
 async function changeMode(accountMode:'DEMO'|'REAL'){
  if(modeBusy)return;
  setModeBusy(true);setModeError('');
  try{
   const response=await fetch('/api/account/mode',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({accountMode})});
   if(!response.ok){setModeError('Mode update failed');return;}
   await update();router.refresh();close();
  }catch{setModeError('Mode update failed');}
  finally{setModeBusy(false)}
 }
 async function logout(){
  close();setLoggingOut(true);
  try{await signOut({callbackUrl:'/login'})}
  catch{setLoggingOut(false);setModeError('Unable to sign out. Please try again.')}
 }
 useEffect(()=>{setOpen(false)},[pathname]);
 return <header className={`site-nav ${status==='authenticated'?'site-nav-authenticated':''} ${status==='authenticated'&&data?.user?.role==='ADMIN'?'site-nav-admin':''}`}><div className="nav-inner">
   <Link href="/" className="brand" onClick={close}><Image src="/aurevia-logo.png" alt="Aurevia Invest" width={38} height={38}/><span>AUREVIA <b>INVEST</b></span></Link>
   <nav id="primary-navigation" aria-label="Primary navigation" className={`nav-links ${open?'nav-open':''}`} onKeyDown={event=>{if(event.key==='Escape')close()}}>
    {status==='loading'?<span className="muted text-sm" aria-live="polite">{translate('restoringSession')}</span>:<>
     {status==='unauthenticated'&&<section className="nav-menu-group" aria-labelledby="nav-access-heading">
      <h2 className="nav-menu-section" id="nav-access-heading">ACCOUNT ACCESS</h2>
      <Link href="/login" onClick={close}>{translate('signIn')}</Link>
      <Link href="/register" className="nav-cta" onClick={close}>{translate('createAccount')}</Link>
     </section>}
    {status==='authenticated'&&data?.user&&<div className="nav-account-snapshot"><span className="nav-account-monogram">{(data.user.name||data.user.email||'A').trim().slice(0,1).toUpperCase()}</span><span className="nav-account-copy"><small>ACCOUNT SPACE</small><b>{data.user.name||data.user.email}</b><em>{data.user.accountMode} ACCOUNT</em></span></div>}
     <section className="nav-menu-group" aria-labelledby="nav-overview-heading">
      <h2 className="nav-menu-section" id="nav-overview-heading">OVERVIEW</h2>
      <Link href="/" onClick={close} aria-current={pathname==='/'?'page':undefined}>{translate('home')}</Link>
      <Link href="/dashboard" onClick={close} aria-current={active('/dashboard')?'page':undefined}><LayoutDashboard size={16} aria-hidden="true"/>{translate('dashboard')}</Link>
      {status==='authenticated'&&data?.user?.role==='ADMIN'&&<Link href="/admin" className="nav-admin-entry" onClick={close} aria-current={active('/admin')?'page':undefined}><ShieldCheck size={16} aria-hidden="true"/>Open Admin Console</Link>}
     </section>
     <section className="nav-menu-group" aria-labelledby="nav-investing-heading">
      <h2 className="nav-menu-section" id="nav-investing-heading">INVESTING</h2>
      <Link href="/markets" onClick={close} aria-current={active('/markets')?'page':undefined}><LineChart size={16} aria-hidden="true"/>{translate('markets')}</Link>
      <Link href="/trade" onClick={close} aria-current={active('/trade')?'page':undefined}><ActivityIcon/>{translate('trade')}</Link>
      <Link href="/investments" onClick={close} aria-current={active('/investments')?'page':undefined}><BriefcaseBusiness size={16} aria-hidden="true"/>Opportunities</Link>
     </section>
     <section className="nav-menu-group" aria-labelledby="nav-portfolio-heading">
      <h2 className="nav-menu-section" id="nav-portfolio-heading">PORTFOLIO</h2>
      <Link href="/orders" onClick={close} aria-current={active('/orders')?'page':undefined}>{translate('orders')}</Link>
      <Link href="/wallet/transactions" onClick={close} aria-current={active('/wallet/transactions')?'page':undefined}><History size={16} aria-hidden="true"/>History</Link>
        <Link href="/broadcasts" onClick={close} aria-current={active('/broadcasts')?'page':undefined}><Radio size={16} aria-hidden="true"/>Live broadcasts</Link>
     </section>
     <section className="nav-menu-group" aria-labelledby="nav-account-heading">
      <h2 className="nav-menu-section" id="nav-account-heading">ACCOUNT &amp; SUPPORT</h2>
      <Link href="/wallet" onClick={close} aria-current={active('/wallet')?'page':undefined}><Wallet size={16} aria-hidden="true"/>{translate('wallet')}</Link>
      <Link href="/kyc" onClick={close} aria-current={active('/kyc')?'page':undefined}><ShieldCheck size={16} aria-hidden="true"/>{translate('verification')}</Link>
      <Link href="/settings" onClick={close} aria-current={active('/settings')?'page':undefined}><Settings size={16} aria-hidden="true"/>{translate('settings')}</Link>
      <Link href="/notifications" onClick={close} aria-current={active('/notifications')?'page':undefined}>{translate('notifications')}</Link>
      <Link href="/support" onClick={close} aria-current={active('/support')?'page':undefined}>{translate('support')}</Link>
      <a className="nav-contact" href="tel:+12105047697" onClick={close}><PhoneCall size={16} aria-hidden="true"/><span><b>Call Support</b><small>+1 (210) 504-7697</small></span></a>
      <a className="nav-contact" href="mailto:aureviainvest@gmail.com" onClick={close}><Mail size={16} aria-hidden="true"/><span><b>Email</b><small>aureviainvest@gmail.com</small></span></a>
     </section>
     {status==='authenticated'&&data?.user&&<div className="nav-menu-tools">
      <label className="mode-switch-wrap"><span>{translate('accountMode')}</span><select className="mode-switch" aria-label={translate('accountMode')} value={data.user.accountMode} disabled={modeBusy||loggingOut} aria-busy={modeBusy} onChange={event=>void changeMode(event.target.value as 'DEMO'|'REAL')}><option value="DEMO">{translate('demo')}</option><option value="REAL">{translate('real')}</option></select></label>
      {modeError&&<span className="text-xs text-loss" role="alert">{modeError}</span>}
      <button type="button" className="nav-logout" disabled={loggingOut} aria-busy={loggingOut} onClick={()=>void logout()}><LogOut size={16} aria-hidden="true"/>{loggingOut?translate('signingOut'):translate('logout')}</button>
     </div>}
    </>}
   </nav>
   <div className="nav-actions"><NotificationBell/><LanguageSelector/><button className="menu-button" type="button" aria-label={open?translate('closeMenu'):translate('openMenu')} aria-expanded={open} aria-controls="primary-navigation" onClick={()=>setOpen(!open)}>{open?<X aria-hidden="true"/>:<Menu aria-hidden="true"/>}</button></div>
 </div></header>
}

function ActivityIcon(){return <LineChart size={15} aria-hidden="true"/>}

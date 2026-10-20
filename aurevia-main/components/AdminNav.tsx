'use client';

import Image from 'next/image';
import Link from 'next/link';
import {signOut,useSession} from 'next-auth/react';
import {usePathname} from 'next/navigation';
import {BriefcaseBusiness,ClipboardCheck,FileCheck2,LayoutDashboard,LogOut,Menu,MessageSquareText,Radio,ReceiptText,ScrollText,Settings2,ShieldCheck,SlidersHorizontal,Trash2,UsersRound,X} from 'lucide-react';
import {useEffect,useState} from 'react';

const groups=[
	{title:'Workspace',links:[
		{href:'/admin',label:'Control room',icon:LayoutDashboard},
		{href:'/admin/users',label:'User accounts',icon:UsersRound},
		{href:'/admin/content',label:'Client stories',icon:Radio},
		{href:'/admin/broadcasts',label:'Broadcasts',icon:Radio},
		{href:'/admin/investments',label:'Investment operations',icon:BriefcaseBusiness},
		{href:'/admin/payments',label:'Funding review',icon:ReceiptText},
		{href:'/admin/payments?type=WITHDRAWAL',label:'Withdrawals',icon:ReceiptText},
		{href:'/admin/approved-deposits',label:'Approved deposits',icon:ReceiptText},
		{href:'/admin/approved-withdrawals',label:'Approved withdrawals',icon:ReceiptText},
		{href:'/admin/settlements',label:'Settlements',icon:ReceiptText},
		{href:'/admin/positions',label:'Open positions',icon:BriefcaseBusiness},
		{href:'/admin/markets',label:'Market management',icon:Settings2},
		{href:'/admin/settings',label:'System settings',icon:SlidersHorizontal},
		{href:'/admin/deleted-items',label:'Deleted Items',icon:Trash2},
	]},
	{title:'Account review',links:[
		{href:'/admin/kyc',label:'Pending verification',icon:ClipboardCheck},
		{href:'/admin/verified-accounts',label:'Verified accounts',icon:UsersRound},
		{href:'/admin/tiers',label:'Tier reviews',icon:FileCheck2},
	]},
	{title:'Service & system',links:[
		{href:'/admin/support',label:'Support inbox',icon:MessageSquareText},
		{href:'/admin/waitlist',label:'Customer waitlist',icon:UsersRound},
		{href:'/admin/providers',label:'Provider health',icon:Settings2},
		{href:'/admin/operations',label:'Orders and ledger',icon:ReceiptText},
		{href:'/admin/receipts',label:'Receipt review',icon:ReceiptText},
		{href:'/admin/nova',label:'Nova activity',icon:MessageSquareText},
		{href:'/admin/audit-logs',label:'Audit log',icon:ScrollText},
	]},
];

export default function AdminNav(){
	const {data,status}=useSession();
	const pathname=usePathname();
	const [open,setOpen]=useState(false);
	const [loggingOut,setLoggingOut]=useState(false);
	const isAdmin=status==='authenticated'&&data?.user?.role==='ADMIN';
	const close=()=>setOpen(false);

	useEffect(()=>{setOpen(false)},[pathname]);

	async function logout(){
		if(loggingOut)return;
		setLoggingOut(true);
		try{await signOut({callbackUrl:'/admin/login'})}
		catch{setLoggingOut(false)}
	}

	return <header className="site-nav admin-site-nav">
		<div className="nav-inner admin-nav-inner">
			<Link href="/admin" className="admin-brand" onClick={close} aria-label="Aurevia administration control room">
				<span className="admin-brand-mark"><Image src="/aurevia-logo.png" alt="" width={34} height={34}/></span>
				<span className="admin-brand-type"><b>AUREVIA</b><small>OPERATIONS</small></span>
			</Link>
			<div className="admin-console-label"><ShieldCheck size={14}/><span>ADMIN CONSOLE</span></div>
			<nav id="admin-navigation" aria-label="Administrator navigation" className={`admin-command-links ${open?'is-open':''}`} onKeyDown={event=>{if(event.key==='Escape')close()}}>
				{status==='loading'?<p className="admin-nav-loading" role="status">Restoring administrator session…</p>:isAdmin?<div className="admin-command-groups">{groups.map(group=><section className="admin-command-group" key={group.title} aria-label={group.title}>
					<h2>{group.title}</h2>
					{group.links.map(({href,label,icon:Icon})=><Link key={href} href={href} title={label} aria-label={label} onClick={close} aria-current={!href.includes('#')&&pathname===href?'page':undefined}><Icon size={15} aria-hidden="true"/><span>{label}</span></Link>)}
				</section>)}</div>:<p className="admin-nav-loading">Administrator access required</p>}
			</nav>
			<div className="admin-nav-actions">
				<button className="admin-menu-button" type="button" aria-label={open?'Close admin menu':'Open admin menu'} aria-expanded={open} aria-controls="admin-navigation" onClick={()=>setOpen(value=>!value)}>{open?<X size={19}/>:<Menu size={19}/>}</button>
				{isAdmin&&<button className="admin-nav-logout" type="button" disabled={loggingOut} aria-busy={loggingOut} onClick={()=>void logout()}><LogOut size={15}/><span>{loggingOut?'Signing out…':'Logout'}</span></button>}
			</div>
		</div>
	</header>;
}

'use client';

import {FormEvent,useCallback,useEffect,useState} from 'react';
import Link from 'next/link';
import {useSession} from 'next-auth/react';
import {Check,Clock3,LockKeyhole,ShieldCheck} from 'lucide-react';
import Nav from '@/components/Nav';

type TierRequest={id:string;currentTier:number;requestedTier:number;status:string;userMessage:string|null;adminReason:string|null;createdAt:string;reviewedAt:string|null};
type TierData={
	tier:string;currentTier:number;canRequest:boolean;
	requirements:{profileComplete:boolean;verificationSubmitted:boolean;identityDocumentUploaded:boolean;identityDocumentApproved:boolean};
	requests:TierRequest[];
};
const tiers=[
	{number:1,title:'Basic access',description:'Explore simulated markets, portfolio data, watchlists, and basic account tools.'},
	{number:2,title:'Additional capabilities',description:'Available after profile completion and administrator review.'},
	{number:3,title:'Highest review tier',description:'Requires submitted identity information, an uploaded document, and administrator approval.'},
];

export default function AccountTierPanel(){
	const {data:session}=useSession();
	const [data,setData]=useState<TierData|null>(null);
	const [message,setMessage]=useState('');
	const [error,setError]=useState('');
	const [notice,setNotice]=useState('');
	const [busy,setBusy]=useState(false);
	const [loading,setLoading]=useState(true);
	const load=useCallback(async()=>{
		setLoading(true);
		try{const response=await fetch('/api/tier-requests',{cache:'no-store'});const result=await response.json();if(!response.ok)throw new Error(result.error||'Unable to load tier status.');setData(result);setError('')}
		catch(exception){setError(exception instanceof Error?exception.message:'Unable to load tier status.')}
		finally{setLoading(false)}
	},[]);
	useEffect(()=>{void load()},[load]);
	async function requestUpgrade(event:FormEvent<HTMLFormElement>){
		event.preventDefault();if(busy)return;setBusy(true);setError('');setNotice('');
		try{const response=await fetch('/api/tier-requests',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({message})});const result=await response.json();if(!response.ok)throw new Error(result.error||'Unable to submit your tier review request.');setNotice(`Your Tier ${result.requestedTier} request is waiting for administrator review.`);setMessage('');await load()}
		catch(exception){setError(exception instanceof Error?exception.message:'Unable to submit your tier review request.')}
		finally{setBusy(false)}
	}
	async function submitAdditionalInformation(event:FormEvent<HTMLFormElement>){
		event.preventDefault();if(!latest||busy)return;setBusy(true);setError('');setNotice('');
		try{const response=await fetch('/api/tier-requests',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({id:latest.id,message})});const result=await response.json();if(!response.ok)throw new Error(result.error||'Unable to submit additional information.');setNotice('Your additional information is back with the administrator for review.');setMessage('');await load()}
		catch(exception){setError(exception instanceof Error?exception.message:'Unable to submit additional information.')}
		finally{setBusy(false)}
	}
	const currentTier=data?.currentTier||1;
	const latest=data?.requests[0];
	return <><Nav/><main className="account-page">
		<header className="account-heading"><div><span className="account-kicker">Account access · {session?.user?.accountMode||'ACCOUNT'}</span><h1>Tier and verification</h1><p>Step-by-step reviews with no invented financial limits or automatic upgrades.</p></div><span className={`status-pill ${session?.user?.accountMode==='REAL'?'mode-real':'mode-demo'}`}>{data?.tier||'ACCOUNT'} · CURRENT</span></header>
		{loading&&!data&&<p className="account-empty" role="status">Loading tier status…</p>}{error&&<p className="text-sm text-loss" role="alert">{error}</p>}{notice&&<p className="text-sm text-profit" role="status">{notice}</p>}
		<div className="mt-4 grid gap-4 lg:grid-cols-3">{tiers.map(tier=>{const current=tier.number===currentTier;const complete=tier.number<currentTier;return <article className={`card p-5 ${current?'border-gold/50':''}`} key={tier.number}><div className="flex items-center justify-between"><h2 className="font-bold">TIER {tier.number}</h2>{current||complete?<ShieldCheck size={18} className="gold"/>:<Clock3 size={18} className="muted"/>}</div><h3 className="mt-4 text-lg font-semibold">{tier.title}</h3><p className="mt-2 text-sm leading-6 muted">{tier.description}</p><div className="mt-5 border-t border-white/10 pt-4"><span className="muted text-xs">Status</span><p className="mt-1 text-sm">{current?'Current tier':complete?'Reviewed and completed':'Available after the previous tier'}</p></div></article>})}</div>
		<section className="account-panel card p-5 mt-4"><div className="account-panel-title"><div><h2>Requirements and progress</h2><p className="account-panel-subtitle">Admin decisions are recorded and never triggered by document submission alone.</p></div><LockKeyhole size={18} className="gold"/></div>
			<div className="mt-4 grid gap-3 sm:grid-cols-2"><p className="text-sm"><Check size={15} className="mr-2 inline gold"/>Profile name and country {data?.requirements.profileComplete?'complete':'incomplete'}</p><p className="text-sm"><Check size={15} className="mr-2 inline gold"/>Identity information {data?.requirements.verificationSubmitted?'submitted':'not submitted'}</p><p className="text-sm"><Check size={15} className="mr-2 inline gold"/>Identity document {data?.requirements.identityDocumentUploaded?'uploaded':'not uploaded'}</p><p className="text-sm"><Check size={15} className="mr-2 inline gold"/>Identity document review {data?.requirements.identityDocumentApproved?'approved':'not approved'}</p></div>
			<div className="mt-4 flex flex-wrap gap-2"><Link className="button-secondary" href="/settings">Complete profile</Link><Link className="button-secondary" href="/kyc">Open identity verification</Link></div>
			{data?.canRequest&&<form className="mt-5 grid gap-3 border-t border-white/10 pt-5" onSubmit={event=>void requestUpgrade(event)}><label className="account-label">Optional note for the reviewer<textarea className="input min-h-20" maxLength={1000} value={message} onChange={event=>setMessage(event.target.value)} placeholder="Add context for your tier review."/></label><button className="btn bg-gold text-black" disabled={busy||!data.requirements.profileComplete}>{busy?'Submitting…':`Request Tier ${currentTier+1} review`}</button><p className="text-xs muted">Submitting is only a request. It does not change access until an administrator records an approval.</p></form>}
			{latest&&<div className="mt-5 border-t border-white/10 pt-4"><h3 className="text-sm font-semibold">Latest request · Tier {latest.requestedTier} · {latest.status.replaceAll('_',' ')}</h3>{latest.adminReason&&<p className="mt-2 text-sm muted">Administrator note: {latest.adminReason}</p>}{latest.status==='NEEDS_INFORMATION'&&<form className="mt-3 grid gap-3" onSubmit={event=>void submitAdditionalInformation(event)}><label className="account-label">Additional information<textarea className="input min-h-20" required minLength={3} maxLength={1000} value={message} onChange={event=>setMessage(event.target.value)}/></label><button className="btn bg-gold text-black" disabled={busy||message.trim().length<3}>{busy?'Submitting…':'Send information for review'}</button><p className="text-xs muted">Upload any requested identity documents through the private verification page.</p></form>}</div>}
			{data?.requests&&data.requests.length>1&&<div className="mt-4 grid gap-2">{data.requests.slice(1).map(request=><p className="text-xs muted" key={request.id}>Tier {request.requestedTier} · {request.status.replaceAll('_',' ')} · {new Date(request.createdAt).toLocaleDateString()}</p>)}</div>}
			<p className="mt-4 text-xs leading-5 muted">Tier review does not enable real-money services, authorize trading, or create financial limits. REAL execution remains separately controlled by configured providers and authorization policy.</p>
		</section>
	</main></>;
}

'use client';

import {useCallback,useEffect,useMemo,useState} from 'react';
import Link from 'next/link';
import {ArrowLeft,Check,ExternalLink,RefreshCw,X} from 'lucide-react';
import AdminNav from '@/components/AdminNav';
import {formatUsd} from '@/lib/currency-format';

type Funding={id:string;user:{email:string;name:string|null};type:'DEPOSIT'|'WITHDRAWAL';accountMode:'DEMO'|'REAL';method:string;amount:string|number;creditedAmount:string|number|null;creditedCurrency:string|null;currency:string;network:string|null;verifiedAt:string|null;status:string;createdAt:string;reviewedAt:string|null;settledAt:string|null;settlementReference:string|null;transactionReference:string|null;note:string|null;adminNote:string|null;hasReceipt:boolean};
type Decision='APPROVED'|'REJECTED'|'REQUEST_INFO';
type RequestFilter='ALL'|'DEPOSIT'|'WITHDRAWAL';
const amount=(value:string|number,currency:string)=>currency.toUpperCase()==='USD'?formatUsd(value):`${Number(value).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:8})} ${currency}`;

export default function AdminPayments(){
	const [queue,setQueue]=useState<Funding[]>([]);
	const [history,setHistory]=useState<Funding[]>([]);
	const [notes,setNotes]=useState<Record<string,string>>({});
	const [requestFilter,setRequestFilter]=useState<RequestFilter>('ALL');
	const [search,setSearch]=useState('');
	const [loading,setLoading]=useState(true);
	const [busy,setBusy]=useState('');
	const [message,setMessage]=useState('');
	const [error,setError]=useState('');
	const load=useCallback(async(showLoading=true)=>{
		if(showLoading)setLoading(true);
		try{
			const typeQuery=requestFilter==='ALL'?'':`type=${requestFilter}`;
			const [pendingResponse,historyResponse]=await Promise.all([
				fetch(`/api/admin/funding${typeQuery?`?${typeQuery}`:''}`,{cache:'no-store'}),
				fetch(`/api/admin/funding?history=true${typeQuery?`&${typeQuery}`:''}`,{cache:'no-store'}),
			]);
			const [pendingData,historyData]=await Promise.all([pendingResponse.json(),historyResponse.json()]);
			if(!pendingResponse.ok||!historyResponse.ok)throw new Error('Administrator authorization required.');
			setQueue(pendingData);setHistory(historyData);setError('');
		}catch(exception){setError(exception instanceof Error?exception.message:'Unable to load internal funding records.')}
		finally{if(showLoading)setLoading(false)}
	},[requestFilter]);
	useEffect(()=>{
		const selected=new URLSearchParams(window.location.search).get('type');
		if(selected==='DEPOSIT'||selected==='WITHDRAWAL')setRequestFilter(selected);
	},[]);
	useEffect(()=>{void load();const timer=window.setInterval(()=>void load(false),10000);return()=>window.clearInterval(timer)},[load]);
	const visibleHistory=useMemo(()=>{
		const term=search.trim().toLowerCase();
		return term?history.filter(item=>`${item.id} ${item.user.name||''} ${item.user.email} ${item.status} ${item.accountMode}`.toLowerCase().includes(term)):history;
	},[history,search]);
	async function review(request:Funding,decision:Decision){
		if(busy)return;
		const note=notes[request.id]?.trim();
		if(decision==='REQUEST_INFO'&&(!note||note.length<3)){setError('Add an administrator review note of at least 3 characters.');return}
		setBusy(request.id);setError('');setMessage('');
		try{
			const response=await fetch('/api/admin/funding',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({id:request.id,decision,note:note||undefined})});
			const result=await response.json();if(!response.ok)throw new Error(result.error||'Unable to update this request.');
			setMessage(decision==='REQUEST_INFO'?`More information requested from ${request.user.email}.`:decision==='APPROVED'?`Internal REAL ${request.type.toLowerCase()} request approved for ${request.user.email}. The internal ledger was updated once.`:`Internal REAL ${request.type.toLowerCase()} request rejected for ${request.user.email}.`);
			await load(false);
		}catch(exception){setError(exception instanceof Error?exception.message:'Unable to update this request.')}
		finally{setBusy('')}
	}
	async function openEvidence(id:string){
		try{const response=await fetch(`/api/admin/funding/${encodeURIComponent(id)}/receipt`,{cache:'no-store'});const data=await response.json();if(!response.ok)throw new Error(data.error||'Evidence unavailable.');window.open(data.url,'_blank','noopener,noreferrer')}
		catch(exception){setError(exception instanceof Error?exception.message:'Evidence unavailable.')}
	}
	return <><AdminNav/><main className="account-page">
		<header className="account-heading"><div><span className="account-kicker">ADMINISTRATION · FUNDING</span><h1>{requestFilter==='WITHDRAWAL'?'Withdrawal review':requestFilter==='DEPOSIT'?'Funding review':'Funding & withdrawal review'}</h1><p>Review internal REAL account credit and withdrawal requests. Approval posts one ledger entry; no external payment or transfer is processed. Legacy DEMO requests may only be rejected.</p></div><div className="flex gap-2"><Link className="button-secondary" href="/admin"><ArrowLeft size={14}/> Admin home</Link><button className="icon-action" type="button" aria-label="Refresh funding records" onClick={()=>void load()} disabled={loading}><RefreshCw size={15}/></button></div></header>
		<div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Funding request type">
			{(['ALL','DEPOSIT','WITHDRAWAL'] as const).map(filter=><button key={filter} type="button" aria-pressed={requestFilter===filter} className={`btn min-h-10 ${requestFilter===filter?'bg-gold text-black':'bg-white/5'}`} onClick={()=>{setRequestFilter(filter);const url=new URL(window.location.href);if(filter==='ALL')url.searchParams.delete('type');else url.searchParams.set('type',filter);window.history.replaceState(null,'',url)}}>{filter==='ALL'?'All requests':filter==='DEPOSIT'?'Funding requests':'Withdrawals'}</button>)}
		</div>
		{message&&<p className="mb-3 text-sm text-profit" role="status">{message}</p>}{error&&<p className="mb-3 text-sm text-loss" role="alert">{error}</p>}
		<section className="account-panel card p-5"><div className="account-panel-title"><div><h2>{requestFilter==='WITHDRAWAL'?'Withdrawal requests awaiting review':requestFilter==='DEPOSIT'?'Funding requests awaiting review':'Requests awaiting review'}</h2><p className="account-panel-subtitle">User requests remain ledger-neutral until an authorized administrator acts.</p></div><span className="status-pill">{queue.length} pending</span></div>
			{loading&&!queue.length?<p className="account-empty" role="status">Loading requests…</p>:queue.length?<div className="admin-funding-list">{queue.map(request=>{const demoRequest=request.accountMode==='DEMO';return <article className="admin-funding-row" key={request.id}>
				<div className="admin-funding-summary"><b>{request.type} · {request.accountMode} account</b><span>{amount(request.amount,request.currency)} requested · {request.status.replaceAll('_',' ')}</span><small>{request.user.name||request.user.email} · {request.user.email}</small><small>{request.id} · {new Date(request.createdAt).toLocaleString()}</small>{request.transactionReference&&<small className="break-all">User-submitted reference: {request.transactionReference}</small>}{request.hasReceipt&&<><small>Optional user-submitted attachment available for review; not independently verified.</small><button type="button" className="text-link" onClick={()=>void openEvidence(request.id)}>Open private attachment <ExternalLink size={13}/></button></>}</div>
				{demoRequest&&<p className="account-callout account-mode-notice">DEMO funding is disabled. Reject this legacy request to close it without changing the account balance.</p>}
				<label className="account-label">Administrator note<input className="input min-h-11" value={notes[request.id]||''} maxLength={500} onChange={event=>setNotes(current=>({...current,[request.id]:event.target.value}))} placeholder="Optional note; required when requesting information"/></label>
				<div className="flex flex-wrap gap-2">{!demoRequest&&<button type="button" disabled={busy===request.id||request.currency!=='USD'} className="btn min-h-11 bg-profit px-4 text-black disabled:opacity-50" onClick={()=>void review(request,'APPROVED')}><Check size={14}/>{request.type==='WITHDRAWAL'?'Approve and debit internal ledger':'Approve and credit internal ledger'}</button>}<button type="button" disabled={busy===request.id} className="btn min-h-11 bg-loss px-4 text-white disabled:opacity-50" onClick={()=>void review(request,'REJECTED')}><X size={14}/>Reject</button>{!demoRequest&&<button type="button" disabled={busy===request.id||!notes[request.id]?.trim()} className="btn min-h-11 bg-white/5 px-4 disabled:opacity-50" onClick={()=>void review(request,'REQUEST_INFO')}>Request information</button>}</div>
			</article>})}</div>:<p className="account-empty">No funding requests await review.</p>}
		</section>
		<section className="account-panel card mt-4 p-5"><div className="account-panel-title"><div><h2>Transaction history</h2><p className="account-panel-subtitle">Persisted request status for both isolated account modes.</p></div></div>
			<label className="account-label mt-3 block max-w-xl">Search requests<input className="input mt-1 min-h-11" value={search} onChange={event=>setSearch(event.target.value)} placeholder="User, email, request ID, status" maxLength={120}/></label>
			<div className="account-table-wrap mt-4"><table className="account-table min-w-[760px]"><thead><tr><th>Reference</th><th>User</th><th>Account</th><th>Amount</th><th>Status</th><th>Updated</th></tr></thead><tbody>{visibleHistory.map(request=><tr key={request.id}><td className="font-mono text-xs">{request.id}</td><td>{request.user.name||request.user.email}<small className="block muted">{request.user.email}</small></td><td>{request.accountMode}{request.currency==='BTC'?' · BTC evidence':' simulated'}</td><td>{request.type} · {amount(request.amount,request.currency)}{request.creditedAmount!==null&&request.creditedCurrency&&<small className="block muted">Credited {amount(request.creditedAmount,request.creditedCurrency)}</small>}</td><td><span className="status-pill">{request.status.replaceAll('_',' ')}{request.verifiedAt?' · VERIFIED':''}</span></td><td>{new Date(request.settledAt||request.reviewedAt||request.createdAt).toLocaleString()}</td></tr>)}{!visibleHistory.length&&<tr><td colSpan={6} className="account-empty">No matching funding records.</td></tr>}</tbody></table></div>
		</section>
	</main></>;
}
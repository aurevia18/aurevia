'use client';

import {useEffect,useMemo,useState} from 'react';
import Link from 'next/link';
import {ArrowLeft,Check,ExternalLink,RefreshCw,X} from 'lucide-react';
import AdminNav from '@/components/AdminNav';
import {formatUsd} from '@/lib/currency-format';

type Funding={id:string;user:{email:string;name:string|null};type:'DEPOSIT'|'WITHDRAWAL';accountMode:'DEMO'|'REAL';method:string;amount:string|number;creditedAmount:string|number|null;creditedCurrency:string|null;currency:string;network:string|null;verifiedAt:string|null;status:string;createdAt:string;reviewedAt:string|null;settledAt:string|null;settlementReference:string|null;transactionReference:string|null;note:string|null;adminNote:string|null;hasReceipt:boolean};
type Decision='VERIFIED'|'APPROVED'|'REJECTED'|'REQUEST_INFO';
const amount=(value:string|number,currency:string)=>currency.toUpperCase()==='USD'?formatUsd(value):`${Number(value).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:8})} ${currency}`;

export default function AdminPayments(){
	const [queue,setQueue]=useState<Funding[]>([]);
	const [history,setHistory]=useState<Funding[]>([]);
	const [notes,setNotes]=useState<Record<string,string>>({});
	const [usdCredits,setUsdCredits]=useState<Record<string,string>>({});
	const [search,setSearch]=useState('');
	const [loading,setLoading]=useState(true);
	const [busy,setBusy]=useState('');
	const [message,setMessage]=useState('');
	const [error,setError]=useState('');
	async function load(showLoading=true){
		if(showLoading)setLoading(true);
		try{
			const [pendingResponse,historyResponse]=await Promise.all([
				fetch('/api/admin/funding',{cache:'no-store'}),
				fetch('/api/admin/funding?history=true',{cache:'no-store'}),
			]);
			const [pendingData,historyData]=await Promise.all([pendingResponse.json(),historyResponse.json()]);
			if(!pendingResponse.ok||!historyResponse.ok)throw new Error('Administrator authorization required.');
			setQueue(pendingData);setHistory(historyData);setError('');
		}catch(exception){setError(exception instanceof Error?exception.message:'Unable to load simulated funding records.')}
		finally{if(showLoading)setLoading(false)}
	}
	useEffect(()=>{void load();const timer=window.setInterval(()=>void load(false),10000);return()=>window.clearInterval(timer)},[]);
	const visibleHistory=useMemo(()=>{
		const term=search.trim().toLowerCase();
		return term?history.filter(item=>`${item.id} ${item.user.name||''} ${item.user.email} ${item.status} ${item.accountMode}`.toLowerCase().includes(term)):history;
	},[history,search]);
	async function review(request:Funding,decision:Decision){
		if(busy)return;
		const note=notes[request.id]?.trim();
		const bitcoinDeposit=request.accountMode==='REAL'&&request.type==='DEPOSIT'&&request.currency==='BTC'&&request.network==='BITCOIN';
		const creditedAmount=bitcoinDeposit&&decision==='APPROVED'?Number(usdCredits[request.id]):undefined;
		if((decision==='REQUEST_INFO'||decision==='VERIFIED'||bitcoinDeposit&&decision==='APPROVED')&&(!note||note.length<3)){setError('Add an administrator review note of at least 3 characters.');return}
		if(bitcoinDeposit&&decision==='APPROVED'&&(!Number.isFinite(creditedAmount)||Number(creditedAmount)<=0)){setError('Enter the USD amount to credit after reviewing the transaction.');return}
		setBusy(request.id);setError('');setMessage('');
		try{
			const response=await fetch('/api/admin/funding',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({id:request.id,decision,note:note||undefined,creditedAmount})});
			const result=await response.json();if(!response.ok)throw new Error(result.error||'Unable to update this request.');
			setMessage(decision==='VERIFIED'?`BTC transaction manually marked verified for ${request.user.email}; no wallet credit was made.`:decision==='REQUEST_INFO'?`More information requested from ${request.user.email}.`:bitcoinDeposit&&decision==='APPROVED'?`Manually verified BTC deposit approved; ${creditedAmount} USD credited to ${request.user.email}'s REAL internal wallet.`:request.type==='WITHDRAWAL'&&decision==='APPROVED'?`Simulated withdrawal completed for ${request.user.email}.`:`Simulated ${request.type.toLowerCase()} ${decision.toLowerCase()} for ${request.user.email}.`);
			await load(false);
		}catch(exception){setError(exception instanceof Error?exception.message:'Unable to update this request.')}
		finally{setBusy('')}
	}
	async function openEvidence(id:string){
		try{const response=await fetch(`/api/admin/funding/${encodeURIComponent(id)}/receipt`,{cache:'no-store'});const data=await response.json();if(!response.ok)throw new Error(data.error||'Evidence unavailable.');window.open(data.url,'_blank','noopener,noreferrer')}
		catch(exception){setError(exception instanceof Error?exception.message:'Evidence unavailable.')}
	}
	return <><AdminNav/><main className="account-page">
		<header className="account-heading"><div><span className="account-kicker">ADMINISTRATION · FUNDING</span><h1>Funding review</h1><p>DEMO requests remain simulated. REAL BTC requests require manual transaction and evidence verification before an administrator can credit the internal USD wallet.</p></div><div className="flex gap-2"><Link className="button-secondary" href="/admin"><ArrowLeft size={14}/> Admin home</Link><button className="icon-action" type="button" aria-label="Refresh funding records" onClick={()=>void load()} disabled={loading}><RefreshCw size={15}/></button></div></header>
		{message&&<p className="mb-3 text-sm text-profit" role="status">{message}</p>}{error&&<p className="mb-3 text-sm text-loss" role="alert">{error}</p>}
		<section className="account-panel card p-5"><div className="account-panel-title"><div><h2>Requests awaiting review</h2><p className="account-panel-subtitle">User requests remain ledger-neutral until an authorized administrator acts.</p></div><span className="status-pill">{queue.length} pending</span></div>
			{loading&&!queue.length?<p className="account-empty" role="status">Loading requests…</p>:queue.length?<div className="admin-funding-list">{queue.map(request=>{const bitcoinDeposit=request.accountMode==='REAL'&&request.type==='DEPOSIT'&&request.currency==='BTC'&&request.network==='BITCOIN';return <article className="admin-funding-row" key={request.id}>
				<div className="admin-funding-summary"><b>{bitcoinDeposit?'REAL · BTC / MANUAL VERIFICATION':`${request.type} · ${request.accountMode} simulated account`}</b><span>{amount(request.amount,request.currency)} {bitcoinDeposit?'reported':'requested'} · {request.status.replaceAll('_',' ')}</span><small>{request.user.name||request.user.email} · {request.user.email}</small><small>{request.id} · {new Date(request.createdAt).toLocaleString()}</small>{request.transactionReference&&<small className="break-all">{bitcoinDeposit?'Bitcoin transaction ID: ':'Reference: '}{request.transactionReference}</small>}{bitcoinDeposit&&<small>{request.verifiedAt?`Manually verified ${new Date(request.verifiedAt).toLocaleString()}`:'Not manually verified; no credit allowed'} · attached screenshot {request.hasReceipt?'available':'missing'}</small>}{request.hasReceipt&&<button type="button" className="text-link" onClick={()=>void openEvidence(request.id)}>Open private receipt screenshot <ExternalLink size={13}/></button>}</div>
				{bitcoinDeposit&&<label className="account-label">USD wallet credit after verification<input className="input min-h-11" type="number" min="0.01" max="100000000" step="0.01" inputMode="decimal" value={usdCredits[request.id]||''} onChange={event=>setUsdCredits(current=>({...current,[request.id]:event.target.value}))} placeholder="Enter verified USD value"/></label>}
				<label className="account-label">{bitcoinDeposit?'Verification / approval note':'Admin review note'}<input className="input min-h-11" value={notes[request.id]||''} maxLength={500} onChange={event=>setNotes(current=>({...current,[request.id]:event.target.value}))} placeholder={bitcoinDeposit?'Record how the transaction and amount were checked':'Required to request more information'}/></label>
				<div className="flex flex-wrap gap-2">{bitcoinDeposit&&!request.verifiedAt&&<button type="button" disabled={busy===request.id||!request.hasReceipt||!notes[request.id]?.trim()} className="btn min-h-11 bg-gold px-4 text-black disabled:opacity-50" onClick={()=>void review(request,'VERIFIED')}><Check size={14}/>Mark manually verified</button>}<button type="button" disabled={busy===request.id||bitcoinDeposit&&(!request.verifiedAt||!usdCredits[request.id])} className="btn min-h-11 bg-profit px-4 text-black disabled:opacity-50" onClick={()=>void review(request,'APPROVED')}><Check size={14}/>{bitcoinDeposit?'Approve verified BTC · credit USD':request.type==='WITHDRAWAL'?'Approve and complete':'Approve simulated credit'}</button><button type="button" disabled={busy===request.id} className="btn min-h-11 bg-loss px-4 text-white disabled:opacity-50" onClick={()=>void review(request,'REJECTED')}><X size={14}/>Reject</button><button type="button" disabled={busy===request.id||!notes[request.id]?.trim()} className="btn min-h-11 bg-white/5 px-4 disabled:opacity-50" onClick={()=>void review(request,'REQUEST_INFO')}>Request information</button></div>
			</article>})}</div>:<p className="account-empty">No funding requests await review.</p>}
		</section>
		<section className="account-panel card mt-4 p-5"><div className="account-panel-title"><div><h2>Transaction history</h2><p className="account-panel-subtitle">Persisted request status for both isolated account modes.</p></div></div>
			<label className="account-label mt-3 block max-w-xl">Search requests<input className="input mt-1 min-h-11" value={search} onChange={event=>setSearch(event.target.value)} placeholder="User, email, request ID, status" maxLength={120}/></label>
			<div className="account-table-wrap mt-4"><table className="account-table min-w-[760px]"><thead><tr><th>Reference</th><th>User</th><th>Account</th><th>Amount</th><th>Status</th><th>Updated</th></tr></thead><tbody>{visibleHistory.map(request=><tr key={request.id}><td className="font-mono text-xs">{request.id}</td><td>{request.user.name||request.user.email}<small className="block muted">{request.user.email}</small></td><td>{request.accountMode}{request.currency==='BTC'?' · BTC evidence':' simulated'}</td><td>{request.type} · {amount(request.amount,request.currency)}{request.creditedAmount!==null&&request.creditedCurrency&&<small className="block muted">Credited {amount(request.creditedAmount,request.creditedCurrency)}</small>}</td><td><span className="status-pill">{request.status.replaceAll('_',' ')}{request.verifiedAt?' · VERIFIED':''}</span></td><td>{new Date(request.settledAt||request.reviewedAt||request.createdAt).toLocaleString()}</td></tr>)}{!visibleHistory.length&&<tr><td colSpan={6} className="account-empty">No matching funding records.</td></tr>}</tbody></table></div>
		</section>
	</main></>;
}
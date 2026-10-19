'use client';

import {useEffect,useState} from 'react';
import {ArrowDown,ArrowUp,ExternalLink,RefreshCw} from 'lucide-react';
import {formatUsd} from '@/lib/currency-format';

type FundingRecord={id:string;type:string;method:string;amount:string|number;creditedAmount:string|number|null;creditedCurrency:string|null;currency:string;status:string;accountMode:string;transactionReference:string|null;verifiedAt:string|null;createdAt:string;reviewedAt:string|null;settledAt:string|null;settlementReference:string|null;hasReceipt:boolean;user:{id:string;name:string|null;email:string};paymentMethod:{name:string}|null};
type Result={items:FundingRecord[];total:number;page:number;pageSize:number;totalPages:number};
type Props={title:string;description:string;type:'DEPOSIT'|'WITHDRAWAL';initialStatuses:string};

const statuses=['PENDING','PENDING_REVIEW','PROCESSING','APPROVED','COMPLETED','REJECTED','FAILED','CANCELLED','REVERSED'];

export default function AdminFundingRecordsPanel({title,description,type,initialStatuses}:Props){
	const [result,setResult]=useState<Result>({items:[],total:0,page:1,pageSize:25,totalPages:0});
	const [status,setStatus]=useState(initialStatuses);
	const [search,setSearch]=useState('');
	const [page,setPage]=useState(1);
	const [sort,setSort]=useState<'asc'|'desc'>('desc');
	const [loading,setLoading]=useState(true);
	const [error,setError]=useState('');
	const [refresh,setRefresh]=useState(0);

	useEffect(()=>{
		const controller=new AbortController();
		const timer=window.setTimeout(async()=>{
			setLoading(true);setError('');
			const params=new URLSearchParams({type,page:String(page),sort});
			if(status)params.set('status',status);
			if(search.trim())params.set('search',search.trim());
			try{
				const response=await fetch(`/api/admin/funding/records?${params}`,{cache:'no-store',signal:controller.signal});
				const data=await response.json();if(!response.ok)throw new Error(data.error||'Unable to load funding records.');
				setResult(data);
			}catch(exception){if(!(exception instanceof DOMException&&exception.name==='AbortError'))setError(exception instanceof Error?exception.message:'Unable to load funding records.')}
			finally{if(!controller.signal.aborted)setLoading(false)}
		},180);
		return()=>{window.clearTimeout(timer);controller.abort()};
	},[page,refresh,search,sort,status,type]);

	async function openReceipt(id:string){
		try{
			const response=await fetch(`/api/admin/funding/${encodeURIComponent(id)}/receipt`,{cache:'no-store'});
			const data=await response.json();if(!response.ok)throw new Error(data.error||'Receipt unavailable.');
			window.open(data.url,'_blank','noopener,noreferrer');
		}catch(exception){setError(exception instanceof Error?exception.message:'Receipt unavailable.')}
	}

	return <div className="account-page">
		<header className="account-heading"><div><span className="account-kicker">WORKSPACE · FUNDING RECORDS</span><h1>{title}</h1><p>{description}</p></div><button className="icon-action" type="button" aria-label="Refresh records" onClick={()=>setRefresh(value=>value+1)}><RefreshCw size={15}/></button></header>
		<div className="mb-4 grid gap-3 sm:grid-cols-[minmax(14rem,1fr)_minmax(12rem,0.5fr)_auto]">
			<label className="account-label">Search<input className="input mt-1" value={search} onChange={event=>{setPage(1);setSearch(event.target.value)}} placeholder="Name, email, request ID, reference" maxLength={120}/></label>
			<label className="account-label">Status<select className="input mt-1" value={status} onChange={event=>{setPage(1);setStatus(event.target.value)}}><option value="">All statuses</option>{statuses.map(value=><option value={value} key={value}>{value.replaceAll('_',' ')}</option>)}</select></label>
			<button className="btn mt-auto min-h-11 bg-white/5" type="button" onClick={()=>setSort(value=>value==='desc'?'asc':'desc')} aria-label={`Sort by date ${sort==='desc'?'oldest first':'newest first'}`}>{sort==='desc'?<ArrowDown size={15}/>:<ArrowUp size={15}/>}Date</button>
		</div>
		{error&&<div className="account-callout mb-3" role="alert">{error}</div>}
		<div className="mb-2 text-sm muted" aria-live="polite">{loading?'Loading records…':`${result.total} records`}</div>
		<div className="overflow-x-auto rounded-md border border-white/10">
			<table className="account-table min-w-[880px]"><thead><tr><th>Request</th><th>User</th><th>Method</th><th>Amount</th><th>Status</th><th>Recorded</th><th>Receipt</th></tr></thead><tbody>
				{result.items.map(item=><tr key={item.id}><td><span className="font-mono text-xs">{item.id}</span>{item.transactionReference&&<small className="block break-all muted">{item.transactionReference}</small>}</td><td>{item.user.name||item.user.email}<small className="block muted">{item.user.email} · {item.accountMode}</small></td><td>{item.paymentMethod?.name||item.method}</td><td>{item.currency==='USD'?formatUsd(item.amount):`${Number(item.amount).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:8})} ${item.currency}`}{item.creditedAmount!==null&&item.creditedCurrency&&<small className="block muted">Credited {item.creditedCurrency==='USD'?formatUsd(item.creditedAmount):`${Number(item.creditedAmount).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:8})} ${item.creditedCurrency}`}</small>}</td><td><span className="status-pill">{item.status.replaceAll('_',' ')}{item.verifiedAt?' · VERIFIED':''}</span></td><td>{new Date(item.settledAt||item.reviewedAt||item.createdAt).toLocaleString()}{item.settlementReference&&<small className="block break-all muted">{item.settlementReference}</small>}</td><td>{item.hasReceipt?<button type="button" className="text-link" onClick={()=>void openReceipt(item.id)}><ExternalLink size={13}/> Open</button>:'—'}</td></tr>)}
				{!loading&&!result.items.length&&<tr><td colSpan={7} className="account-empty">No matching funding records.</td></tr>}
			</tbody></table>
		</div>
		<div className="mt-3 flex items-center justify-between gap-3"><span className="text-xs muted">Page {result.totalPages?result.page:0} of {result.totalPages}</span><div className="flex gap-2"><button type="button" className="btn min-h-10 bg-white/5" disabled={loading||page<=1} onClick={()=>setPage(value=>Math.max(1,value-1))}>Previous</button><button type="button" className="btn min-h-10 bg-white/5" disabled={loading||page>=result.totalPages} onClick={()=>setPage(value=>Math.min(result.totalPages,value+1))}>Next</button></div></div>
	</div>;
}
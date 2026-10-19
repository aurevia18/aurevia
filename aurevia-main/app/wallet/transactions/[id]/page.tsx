'use client';

import {useEffect,useState} from 'react';
import Link from 'next/link';
import {useParams} from 'next/navigation';
import {ArrowLeft,Clock3,FileClock,ShieldCheck} from 'lucide-react';
import Nav from '@/components/Nav';
import DisplayCurrencyPanel from '@/components/DisplayCurrencyPanel';
import {formatUsd} from '@/lib/currency-format';

type FundingTransaction={
	id:string;
	accountMode:'DEMO'|'REAL';
	type:'DEPOSIT'|'WITHDRAWAL';
	amount:string|number;
	creditedAmount:string|number|null;
	creditedCurrency:string|null;
	currency:string;
	status:string;
	method:string;
	createdAt:string;
	updatedAt:string;
	transactionReference:string|null;
	referenceInfo:string|null;
	note:string|null;
	reviewedAt:string|null;
	verifiedAt:string|null;
	network:string|null;
	hasEvidence:boolean;
	adminNote:string|null;
};
type Detail={transaction:FundingTransaction;history:Array<{action:string;createdAt:string;actor?:{name?:string|null;role:string}|null}>};

const labels:Record<string,string>={PENDING:'Pending',PENDING_REVIEW:'Pending review',PROCESSING:'Processing',APPROVED:'Approved',COMPLETED:'Completed',REJECTED:'Rejected',CANCELLED:'Cancelled'};
const formatDate=(value?:string|null)=>value?new Date(value).toLocaleString():'Not recorded';
const formatAmount=(value:string|number,currency:string)=>currency.toUpperCase()==='USD'?formatUsd(value):`${Number(value).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:8})} ${currency}`;

export default function TransactionDetailPage(){
	const {id}=useParams<{id:string}>();
	const [data,setData]=useState<Detail|null>(null);
	const [error,setError]=useState('');
	useEffect(()=>{let active=true;fetch(`/api/funding/${encodeURIComponent(id)}`).then(async response=>{const result=await response.json();if(!response.ok)throw new Error(result.error||'Unable to load transaction.');if(active)setData(result)}).catch(exception=>{if(active)setError(exception instanceof Error?exception.message:'Unable to load transaction.')});return()=>{active=false}},[id]);
	const transaction=data?.transaction;
	const bitcoinDeposit=transaction?.accountMode==='REAL'&&transaction.currency.toUpperCase()==='BTC'&&transaction.type==='DEPOSIT';
	const displayValues=transaction?.currency?.toUpperCase()==='USD'?[{label:'Amount requested',amount:String(transaction.amount)},...(transaction.creditedAmount!==null&&transaction.creditedAmount!==undefined?[{label:'Amount credited',amount:String(transaction.creditedAmount)}]:[])]:[];
	return <><Nav/><main className="account-page">
		<Link href="/wallet" className="text-link"><ArrowLeft size={15}/> Back to wallet</Link>
		{error?<section className="account-panel card mt-4 p-5"><p className="text-loss" role="alert">{error}</p></section>:!transaction?<section className="account-panel card mt-4 p-5" role="status">Loading transaction details…</section>:<>
			<header className="account-heading mt-5"><div><span className="account-kicker">{bitcoinDeposit?'REAL INTERNAL WALLET · BTC MANUAL REVIEW':`${transaction.accountMode} SIMULATED ACCOUNT`} · Transaction detail</span><h1>{bitcoinDeposit?'BTC deposit review request':`Simulated ${transaction.type==='DEPOSIT'?'deposit':'withdrawal'} request`}</h1><p>Internal request reference <span className="font-mono">{transaction.id}</span></p></div><span className="status-pill">{labels[transaction.status]||transaction.status}{bitcoinDeposit&&transaction.verifiedAt?' · manually verified':''}</span></header>
			<DisplayCurrencyPanel values={displayValues}/>
			<div className="account-content-grid">
				<section className="account-panel card p-5"><div className="account-panel-title"><div><h2>Request details</h2><p className="account-panel-subtitle">{bitcoinDeposit?'Aurevia records the submitted BTC amount and transaction reference; admins manually review the evidence. There is no automatic blockchain confirmation or currency conversion.':'This is an internal simulated request. No payment processor, broker, bank, or crypto network is contacted.'}</p></div><FileClock size={18} className="gold" aria-hidden="true"/></div><dl className="transaction-detail-grid"><Detail label={bitcoinDeposit?'BTC amount submitted':'Amount requested'} value={formatAmount(transaction.amount,transaction.currency)}/>{transaction.creditedAmount!==null&&transaction.creditedAmount!==undefined&&<Detail label="Aurevia REAL wallet credit" value={formatAmount(transaction.creditedAmount,transaction.creditedCurrency||transaction.currency)}/>}<Detail label={bitcoinDeposit?'Request type':'Simulated operation'} value={transaction.method}/><Detail label="Submitted" value={formatDate(transaction.createdAt)}/><Detail label="Last updated" value={formatDate(transaction.updatedAt)}/>{bitcoinDeposit&&<Detail label="Bitcoin transaction ID" value={transaction.transactionReference||'Not provided'}/>}<Detail label="Reference" value={transaction.transactionReference||transaction.referenceInfo||'Not provided'}/>{transaction.note&&<Detail label="Your note" value={transaction.note}/>}</dl></section>
				<aside className="account-panel card p-5"><div className="account-panel-title"><div><h2>Review status</h2><p className="account-panel-subtitle">{bitcoinDeposit?transaction.creditedAmount!==null?'An administrator approved an explicit USD credit to the Aurevia REAL internal ledger.':'This request awaits manual evidence review; no wallet credit has been made.':transaction.status==='COMPLETED'?'The simulated ledger transition is complete.':transaction.status==='APPROVED'?'The request was approved.':'This request awaits administrator review.'}</p></div><ShieldCheck size={18} className="gold" aria-hidden="true"/></div><dl className="space-y-4"><Detail label="Manually verified" value={formatDate(transaction.verifiedAt)}/><Detail label="Reviewed" value={formatDate(transaction.reviewedAt)}/><Detail label="Evidence attachment" value={transaction.hasEvidence?bitcoinDeposit?'Private screenshot attached; not itself blockchain confirmation':'Attached to simulated request; not payment verification':'None'}/><Detail label="Administrator note" value={transaction.adminNote||'No note recorded'}/></dl><p className="mt-5 text-xs leading-5 muted">{bitcoinDeposit?'An admin-entered wallet credit is separate from BTC amount, Alpaca Paper funds, and paper profits. No automatic blockchain confirmation is performed.':'This simulated account record does not represent cash received, held assets, broker execution, or an external payout.'}</p></aside>
		</div>
		<section className="account-panel card mt-4 p-5"><div className="account-panel-title"><div><h2>Status history</h2><p className="account-panel-subtitle">Submission and administrator review events.</p></div><Clock3 size={18} className="gold" aria-hidden="true"/></div>{data.history.length?<ol className="activity-list">{data.history.map((entry,index)=><li className="activity-row" key={`${entry.action}-${entry.createdAt}-${index}`}><span className="activity-type">{entry.action.replaceAll('_',' ')}</span><span className="activity-reference">{formatDate(entry.createdAt)}</span><span className="muted">{entry.actor?.role==='ADMIN'?entry.actor.name||'Administrator':'You'}</span></li>)}</ol>:<p className="account-empty">Submitted {formatDate(transaction.createdAt)} · awaiting review.</p>}</section>
		</>}
	</main></>;
}

function Detail({label,value}:{label:string;value:string}){return <div><dt className="muted text-xs">{label}</dt><dd className="mt-1 break-words text-sm">{value}</dd></div>}
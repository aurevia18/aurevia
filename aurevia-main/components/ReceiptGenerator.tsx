'use client';

import {useRef,useState} from 'react';
import {Check,ChevronDown,Download,Landmark,X} from 'lucide-react';
import html2canvas from 'html2canvas-pro';
import {jsPDF} from 'jspdf';
import {formatUsd} from '@/lib/currency-format';

export type ReceiptData={
	id:string;
	reference:string;
	status:'PENDING'|'PENDING_REVIEW'|'PROCESSING'|'APPROVED'|'COMPLETED'|'REJECTED'|'FAILED'|'CANCELLED';
	type?:'DEPOSIT'|'WITHDRAWAL'|'CREDIT'|'DEBIT';
	accountMode?:'DEMO'|'REAL';
	simulated?:boolean;
	manualBitcoinDeposit?:boolean;
	isWithdrawal?:boolean;
	createdAt:string;
	reviewedAt?:string|null;
	completedAt?:string|null;
	reviewedBy?:{name:string|null}|null;
	accountReference?:string|null;
	externalReference?:string|null;
	previousBalance?:number|string|null;
	resultingBalance?:number|string|null;
	adminNote?:string|null;
	name:string;
	email:string;
	amount:number|string;
	currency:string;
	creditedCurrency?:string|null;
	method:string;
	creditedAmount?:number|string;
	recipientName?:string|null;
	recipientNumber?:string|null;
	sourceName?:string|null;
	sourceNumber?:string|null;
	destinationName?:string|null;
	destinationNumber?:string|null;
	purpose?:string|null;
	fee?:number|string|null;
	gateway?:string|null;
};

const dateLabel=(value:string)=>{
	const date=new Date(value);
	return Number.isNaN(date.getTime())?'Not recorded':new Intl.DateTimeFormat('en-US',{dateStyle:'medium',timeStyle:'short',timeZone:'UTC'}).format(date);
};
const amountLabel=(value:number|string,currency:string,isWithdrawal:boolean)=>{
	const amount=Number(value);
	if(!Number.isFinite(amount))return '—';
	const formatted=currency==='USD'?formatUsd(Math.abs(amount)):`${Math.abs(amount).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:8})} ${currency}`;
	return isWithdrawal?`-${formatted}`:formatted;
};

export default function ReceiptGenerator({receipt}:{receipt:ReceiptData}){
	const receiptRef=useRef<HTMLElement>(null);
	const [busy,setBusy]=useState(false);
	const [error,setError]=useState('');
	const [visible,setVisible]=useState(true);
	const [showDetails,setShowDetails]=useState(false);
	const currentReceipt=receipt;

	const kind=currentReceipt.type||'DEPOSIT';
	const isWithdrawal=currentReceipt.isWithdrawal===true||kind==='WITHDRAWAL';
	const isBitcoinDeposit=currentReceipt.manualBitcoinDeposit===true;
	const isSuccessful=currentReceipt.status==='COMPLETED'||(currentReceipt.status==='APPROVED'&&!isWithdrawal);
	const isFailed=currentReceipt.status==='REJECTED'||currentReceipt.status==='FAILED'||currentReceipt.status==='CANCELLED';
	const statusLabel=currentReceipt.status==='APPROVED'&&isWithdrawal
		?currentReceipt.accountMode==='REAL'?'Approved · payout not configured':'Approved · awaiting settlement'
		:currentReceipt.status==='APPROVED'?'Approved'
		:currentReceipt.status==='COMPLETED'?'Completed'
		:currentReceipt.status==='REJECTED'?'Rejected'
		:currentReceipt.status==='FAILED'?'Failed'
		:currentReceipt.status==='CANCELLED'?'Cancelled'
		:currentReceipt.status==='PENDING_REVIEW'?'Pending review'
		:currentReceipt.status==='PROCESSING'?'Processing'
		:'Pending';
	const receiptTitle=kind==='DEPOSIT'?'Deposit':kind==='WITHDRAWAL'?'Withdrawal':kind==='CREDIT'?'Account credit':'Account debit';
	const recipientName=currentReceipt.recipientName||currentReceipt.destinationName||'Aurevia-Xchange Inc.';
	const recipientNumber=currentReceipt.recipientNumber||currentReceipt.destinationNumber||'Not provided';
	const sourceName=currentReceipt.sourceName||'My Wallet';
	const sourceNumber=currentReceipt.sourceNumber||currentReceipt.accountReference||'Not provided';
	const destinationName=currentReceipt.destinationName||'Aurevia-Xchange Inc.';
	const destinationNumber=currentReceipt.destinationNumber||currentReceipt.recipientNumber||'Not provided';
	const purpose=currentReceipt.purpose||`${kind.charAt(0)}${kind.slice(1).toLowerCase()} · ${currentReceipt.accountMode||'Simulated'} account`;
	const gateway=currentReceipt.gateway||(isBitcoinDeposit?'Manual Bitcoin review · no automatic confirmation':isWithdrawal&&currentReceipt.accountMode==='REAL'?'No external payout configured':currentReceipt.accountMode==='REAL'?'Aurevia internal ledger':'Aurevia simulated account');
	const fileName=`aurevia-${kind.toLowerCase()}-${currentReceipt.status.toLowerCase()}-${currentReceipt.id}`;

	async function exportReceipt(format:'png'|'pdf'){
		if(!receiptRef.current||busy)return;
		setBusy(true);setError('');
		try{
			const element=receiptRef.current;
			const originalMaxHeight=element.style.maxHeight;
			const originalOverflowY=element.style.overflowY;
			let canvas:HTMLCanvasElement;
			element.style.maxHeight='none';
			element.style.overflowY='visible';
			try{canvas=await html2canvas(element,{scale:2,backgroundColor:'#ffffff',logging:false,useCORS:true});}
			finally{element.style.maxHeight=originalMaxHeight;element.style.overflowY=originalOverflowY;}
			if(format==='png'){
				const link=document.createElement('a');link.download=`${fileName}.png`;link.href=canvas.toDataURL('image/png');link.click();
			}else{
				const pdf=new jsPDF({orientation:'portrait',unit:'px',format:[canvas.width,canvas.height]});
				pdf.addImage(canvas.toDataURL('image/png'),'PNG',0,0,canvas.width,canvas.height);
				pdf.save(`${fileName}.pdf`);
			}
		}catch(exception){
			console.error('Unable to export receipt:',exception instanceof Error?exception.message:'Unknown error');
			setError('This receipt could not be exported. Please try again.');
		}finally{setBusy(false)}
	}

	if(!visible)return <button type="button" className="min-h-10 rounded-lg border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 shadow-sm" onClick={()=>setVisible(true)}>View transaction receipt</button>;

	return <div className="mx-auto grid w-full min-w-0 max-w-2xl gap-3">
		<article ref={receiptRef} className="receipt-container max-h-[70vh] overflow-y-auto rounded-2xl border border-slate-200 bg-white text-slate-900 shadow-lg shadow-slate-900/5 sm:max-h-[min(78vh,760px)]" aria-label={`${receiptTitle} ${currentReceipt.status.toLowerCase().replaceAll('_',' ')} receipt`}>
			<header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-slate-100 bg-white/95 px-4 py-3 backdrop-blur sm:px-6">
				<h2 className="text-base font-semibold tracking-tight sm:text-lg">{isBitcoinDeposit?'BTC deposit review receipt':'Funding request receipt'}</h2>
				<button type="button" className="grid size-10 shrink-0 place-items-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-900" aria-label="Close receipt" onClick={()=>setVisible(false)}><X size={19}/></button>
			</header>
			<div className="px-4 pb-4 pt-4 sm:px-6 sm:pb-5">
				<div className="flex flex-col items-center text-center">
					<div className="grid size-12 place-items-center rounded-full bg-emerald-100 text-emerald-800 ring-4 ring-emerald-50"><Landmark size={22} strokeWidth={1.8}/></div>
					<p className="mt-3 max-w-full break-words text-base font-semibold">{recipientName}</p>
					<p className="mt-1 max-w-full break-all text-sm text-slate-500">{recipientNumber}</p>
					<p className="mt-3 break-words text-2xl font-bold tracking-tight tabular-nums sm:text-3xl">{amountLabel(currentReceipt.amount,currentReceipt.currency,isWithdrawal)}</p>
					<div className={`mt-4 inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-semibold ${isSuccessful?'bg-emerald-50 text-emerald-800':isFailed?'bg-rose-50 text-rose-700':'bg-amber-50 text-amber-800'}`}>
						<span className={`size-2 rounded-full ${isSuccessful?'bg-emerald-500':isFailed?'bg-rose-500':'bg-amber-500'}`} aria-hidden="true"/>
						{isSuccessful&&<Check size={14}/>}
						<span>{statusLabel}</span>
					</div>
					<p className="mt-2 text-xs text-slate-500">{dateLabel(currentReceipt.createdAt)}</p>
				</div>

				<section className="mt-4 rounded-xl border border-slate-200 bg-slate-50/70 p-3 sm:p-4" aria-label="Transaction details">
					<h3 className="text-sm font-semibold text-slate-900">Transfer details</h3>
					<dl className="mt-3 divide-y divide-slate-200/80">
						<ReceiptRow label="Source" value={`${sourceName} · ${sourceNumber}`}/>
						<div className="flex min-w-0 items-start justify-between gap-4 py-3 text-sm"><dt className="shrink-0 text-slate-500">Destination</dt><dd className="flex min-w-0 items-center gap-2 text-right font-medium text-slate-800"><span className="grid size-8 shrink-0 place-items-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-800" aria-hidden="true">A</span><span className="min-w-0"><span className="block break-words">{destinationName}</span><span className="block break-all text-xs font-normal text-slate-500">{destinationNumber}</span></span></dd></div>
						<ReceiptRow label="Purpose" value={purpose}/>
						<ReceiptRow label="Transfer method" value={currentReceipt.method}/>
						<ReceiptRow label="Transaction fee" value={currentReceipt.fee===null||currentReceipt.fee===undefined?'Not recorded':amountLabel(currentReceipt.fee,currentReceipt.currency,false)}/>
						<ReceiptRow label="Gateway" value={gateway}/>
						{currentReceipt.creditedAmount!==undefined&&currentReceipt.creditedAmount!==null&&<ReceiptRow label="Aurevia ledger credit" value={amountLabel(currentReceipt.creditedAmount,currentReceipt.creditedCurrency||currentReceipt.currency,false)}/>}
					</dl>
					<div className="border-t border-slate-200/80">
						<button type="button" className="flex min-h-12 w-full cursor-pointer items-center justify-between gap-3 py-3 text-left text-sm font-semibold text-slate-800" aria-expanded={showDetails} aria-controls={`transaction-details-${currentReceipt.id}`} onClick={()=>setShowDetails(value=>!value)}>
							<span>Transaction details</span><ChevronDown size={16} className={`shrink-0 text-slate-500 transition ${showDetails?'rotate-180':''}`}/>
						</button>
						<dl id={`transaction-details-${currentReceipt.id}`} hidden={!showDetails} className="grid gap-x-5 gap-y-3 border-t border-slate-200/80 pb-2 pt-3 sm:grid-cols-2">
							<ReceiptRow label="Reference ID" value={currentReceipt.reference}/>
							<ReceiptRow label="Transaction type" value={kind.replaceAll('_',' ')}/>
							{currentReceipt.accountMode&&<ReceiptRow label="Account" value={`${currentReceipt.accountMode} ${currentReceipt.accountMode==='DEMO'?'virtual':'internal ledger'} account`}/>}
							{currentReceipt.accountReference&&<ReceiptRow label="Wallet reference" value={currentReceipt.accountReference}/>}
							{currentReceipt.externalReference&&<ReceiptRow label="User reference" value={currentReceipt.externalReference}/>}
							{currentReceipt.reviewedAt&&<ReceiptRow label="Reviewed" value={dateLabel(currentReceipt.reviewedAt)}/>}
							{currentReceipt.completedAt&&<ReceiptRow label="Completed" value={dateLabel(currentReceipt.completedAt)}/>}
							{currentReceipt.reviewedBy?.name&&<ReceiptRow label="Reviewed by" value={currentReceipt.reviewedBy.name}/>}
							{currentReceipt.previousBalance!==null&&currentReceipt.previousBalance!==undefined&&<ReceiptRow label="Previous balance" value={amountLabel(currentReceipt.previousBalance,currentReceipt.currency,false)}/>}
							{currentReceipt.resultingBalance!==null&&currentReceipt.resultingBalance!==undefined&&<ReceiptRow label="Resulting balance" value={amountLabel(currentReceipt.resultingBalance,currentReceipt.currency,false)}/>}
							{currentReceipt.adminNote&&<ReceiptRow label="Review note" value={currentReceipt.adminNote}/>}
						</dl>
					</div>
				</section>
				{isBitcoinDeposit&&<p className="mt-3 rounded-xl bg-amber-50 px-3 py-2.5 text-xs leading-5 text-amber-900"><strong>MANUAL BTC REVIEW RECORD</strong> · Screenshot and transaction ID are submitted evidence, not automatic blockchain confirmation. Any USD amount shown is a separate admin-entered Aurevia ledger credit.</p>}
				{currentReceipt.simulated&&<p className="mt-3 rounded-xl bg-emerald-50 px-3 py-2.5 text-xs leading-5 text-emerald-900"><strong>SIMULATED INTERNAL LEDGER RECORD</strong> · No external payment, bank transfer, held asset, or payout occurred.</p>}
				<footer className="mt-3 border-t border-slate-100 pt-3 text-center text-xs leading-5 text-slate-500">Aurevia Invest · internal funding record</footer>
			</div>
		</article>
		<div className="flex flex-wrap gap-2">
			<button type="button" className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 shadow-sm disabled:opacity-60" disabled={busy} onClick={()=>void exportReceipt('png')}><Download size={14}/>{busy?'Preparing…':'Download PNG'}</button>
			<button type="button" className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 shadow-sm disabled:opacity-60" disabled={busy} onClick={()=>void exportReceipt('pdf')}><Download size={14}/>{busy?'Preparing…':'Download PDF'}</button>
		</div>
		{error&&<p className="text-sm text-rose-700" role="alert">{error}</p>}
	</div>;
}

function ReceiptRow({label,value}:{label:string;value:string}){return <div className="flex min-w-0 items-start justify-between gap-4 py-3 text-sm"><dt className="shrink-0 text-slate-500">{label}</dt><dd className="min-w-0 break-words text-right font-medium text-slate-800">{value||'Not provided'}</dd></div>}

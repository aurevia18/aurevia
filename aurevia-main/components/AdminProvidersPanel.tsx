'use client';

import {useEffect,useState} from 'react';
import {RefreshCw} from 'lucide-react';

type ServiceStatus='AVAILABLE'|'UNAVAILABLE'|'DISABLED';
type AlpacaPaperStatus='AVAILABLE'|'AUTHENTICATION_FAILED'|'UNAVAILABLE'|'NOT_CONFIGURED'|'NOT_SELECTED'|'MISCONFIGURED';
type ProviderStatus={
	checkedAt:string;
	internalSimulation:{simulationEngine:ServiceStatus;accountLedger:ServiceStatus;adminAuthorization:ServiceStatus;simulatedTradeExecution:ServiceStatus;simulatedDepositsAndWithdrawals:ServiceStatus;simulatedInvestmentSettlement:ServiceStatus;externalBrokerExecution:'DISABLED';externalPaymentProcessing:'DISABLED';externalInvestmentSettlement:'DISABLED';externalMoneyMovement:'DISABLED'};
	alpacaPaperAccount:{status:AlpacaPaperStatus;connected:boolean;configured:boolean;selected:boolean;mode:'PAPER'|null;executionEnabled:boolean;paperOrdersEnabled:boolean;liveTradingEnabled:false;account:{accountId:string;status:string;currency:string;cash:string;buyingPower:string;equity:string;portfolioValue:string;patternDayTrader:boolean|null;tradingBlocked:boolean;accountBlocked:boolean;tradeSuspendedByUser:boolean}|null;checkedAt:string};
	marketData:{status:string;provider:string;finnhubStatus:string;fallbackProvider:string|null;usedForOrderExecution:false};
	identity:{status:string;adminReviewAvailable:ServiceStatus;externalVerification:'DISABLED'};
};

const statusClass=(status:string)=>status==='AVAILABLE'?'text-profit':['DISABLED','NOT_CONFIGURED','NOT_SELECTED'].includes(status)?'muted':'text-loss';

export default function AdminProvidersPanel(){
	const [data,setData]=useState<ProviderStatus|null>(null);
	const [error,setError]=useState('');
	const [loading,setLoading]=useState(true);
	async function load(){
		setLoading(true);
		try{
			const response=await fetch('/api/admin/providers/status',{cache:'no-store'});
			const result=await response.json();
			if(!response.ok)throw new Error(result.error||'Simulation health is unavailable.');
			setData(result);setError('');
		}catch(exception){setError(exception instanceof Error?exception.message:'Simulation health is unavailable.')}
		finally{setLoading(false)}
	}
	useEffect(()=>{void load()},[]);
	const services=data?.internalSimulation;
	return <section id="providers" className="card p-4 sm:p-5">
		<header className="flex flex-wrap items-start justify-between gap-3">
			<div><h2 className="font-bold">Internal simulation health</h2><p className="mt-1 text-sm muted">Service status reflects database and service checks. A healthy status does not indicate that a user transaction has occurred.</p></div>
			<button className="btn min-h-11 bg-white/5" type="button" onClick={()=>void load()} disabled={loading}><RefreshCw size={15}/>Refresh</button>
		</header>
		{error?<p className="mt-3 text-sm text-loss" role="alert">{error}</p>:loading&&!data?<p className="mt-3 muted" role="status">Checking internal services…</p>:data&&<div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
			<article className="rounded-lg border border-white/10 p-3"><h3 className="font-semibold">Internal financial operations</h3>
				{([
					['Simulation engine',services!.simulationEngine],['Account ledger',services!.accountLedger],['Admin authorization',services!.adminAuthorization],['Simulated trade execution',services!.simulatedTradeExecution],['Simulated deposits and withdrawals',services!.simulatedDepositsAndWithdrawals],['Simulated investment settlement',services!.simulatedInvestmentSettlement],
				] as [string,ServiceStatus][]).map(([label,status])=><p className="mt-2 flex justify-between gap-3 text-sm" key={label}><span>{label}</span><b className={statusClass(status)}>{status}</b></p>)}
			</article>
			<article className="rounded-lg border border-white/10 p-3"><h3 className="font-semibold">External financial services</h3>
				{([
					['Broker execution',services!.externalBrokerExecution],['Payment processing',services!.externalPaymentProcessing],['Investment settlement',services!.externalInvestmentSettlement],['Money movement',services!.externalMoneyMovement],
				] as [string,'DISABLED'][]).map(([label,status])=><p className="mt-2 flex justify-between gap-3 text-sm" key={label}><span>{label}</span><b className={statusClass(status)}>{status}</b></p>)}
			</article>
			<article className="rounded-lg border border-white/10 p-3"><h3 className="font-semibold">Alpaca paper account</h3>
				<p className="mt-2 flex justify-between gap-3 text-sm"><span>Account connectivity</span><b className={statusClass(data.alpacaPaperAccount.status)}>{data.alpacaPaperAccount.status}</b></p>
				<p className="mt-2 flex justify-between gap-3 text-sm"><span>Configuration</span><b>{data.alpacaPaperAccount.configured?'CONFIGURED':'INCOMPLETE'}</b></p>
				<p className="mt-2 flex justify-between gap-3 text-sm"><span>Paper order submission</span><b className={statusClass(data.alpacaPaperAccount.paperOrdersEnabled?'AVAILABLE':'DISABLED')}>{data.alpacaPaperAccount.paperOrdersEnabled?'ENABLED':'DISABLED'}</b></p>
				<p className="mt-2 flex justify-between gap-3 text-sm"><span>Live trading</span><b className="muted">DISABLED</b></p>
				{data.alpacaPaperAccount.account&&<><p className="mt-2 text-sm">Paper account status: <b>{data.alpacaPaperAccount.account.status}</b></p><p className="break-all text-xs muted">Paper account reference: {data.alpacaPaperAccount.account.accountId}</p><p className="mt-2 text-sm">Paper cash: <b>{data.alpacaPaperAccount.account.currency} {Number(data.alpacaPaperAccount.account.cash).toLocaleString()}</b></p><p className="text-sm">Paper equity: <b>{data.alpacaPaperAccount.account.currency} {Number(data.alpacaPaperAccount.account.equity).toLocaleString()}</b></p><p className="text-sm">Paper buying power: <b>{data.alpacaPaperAccount.account.currency} {Number(data.alpacaPaperAccount.account.buyingPower).toLocaleString()}</b></p></>}
				<p className="mt-2 text-xs muted">Paper account funds and P/L are shared provider-side simulation, not Aurevia REAL user balances or positions. User orders are attributed separately; no paper cash, equity, buying power, or profits are copied into the Aurevia ledger.</p>
			</article>
			<article className="rounded-lg border border-white/10 p-3"><h3 className="font-semibold">Market data</h3><p className="mt-2 text-sm">Status: <b>{data.marketData.status}</b></p><p className="text-sm">Provider: {data.marketData.provider}</p><p className="text-sm">Finnhub: {data.marketData.finnhubStatus}</p><p className="mt-2 text-xs muted">Market data is separate from simulated execution and is not used to move funds.</p></article>
			<article className="rounded-lg border border-white/10 p-3"><h3 className="font-semibold">Identity review</h3><p className="mt-2 text-sm">Admin review: <b className={statusClass(data.identity.adminReviewAvailable)}>{data.identity.adminReviewAvailable}</b></p><p className="text-sm">External verification: <b className={statusClass(data.identity.externalVerification)}>{data.identity.externalVerification}</b></p><p className="mt-2 text-xs muted">Tier 3 reflects internal administrator review only.</p></article>
		</div>}
		{data?.alpacaPaperAccount&&<p className="mt-3 text-xs muted">Alpaca account check completed {new Date(data.alpacaPaperAccount.checkedAt).toLocaleString()}.</p>}
		{data&&<p className="mt-3 text-xs muted">Checked {new Date(data.checkedAt).toLocaleString()}</p>}
	</section>;
}
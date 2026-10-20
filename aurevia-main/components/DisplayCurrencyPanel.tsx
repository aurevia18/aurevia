'use client';

import {useEffect,useState} from 'react';

type Rate={rate:string|number|null;source:string|null;observedAt:string|null;status:'CURRENT'|'STALE'|'INTERNAL'|'UNAVAILABLE'};
type Props={values:Array<{label:string;amount:string|null}>};
const currencies=['USD','EUR','GBP','NGN','CAD','AUD','CHF','JPY'];
const money=(amount:number,currency:string)=>new Intl.NumberFormat(undefined,{style:'currency',currency,minimumFractionDigits:2,maximumFractionDigits:2}).format(amount);

export default function DisplayCurrencyPanel({values}:Props){
	const [currency,setCurrency]=useState('USD');
	const [rate,setRate]=useState<Rate|null>(null);
	const [error,setError]=useState('');
	const [ready,setReady]=useState(false);
	const currentRate=rate?.rate!==null&&rate?.rate!==undefined&&Number.isFinite(Number(rate.rate))&&Number(rate.rate)>0?Number(rate.rate):null;
	useEffect(()=>{
		let active=true;
		void fetch('/api/currency-preference',{cache:'no-store'}).then(async response=>{
			const result=await response.json();
			if(!response.ok)throw new Error(result.error||'Display currency preference unavailable.');
			if(active&&typeof result.currency==='string'&&currencies.includes(result.currency))setCurrency(result.currency);
		}).catch(exception=>{if(active)setError(exception instanceof Error?exception.message:'Display currency preference unavailable.')}).finally(()=>{if(active)setReady(true)});
		return()=>{active=false};
	},[]);
	useEffect(()=>{
		if(currency==='USD'){setRate(null);setError('');return}
		let active=true;
		setRate(null);setError('');
		void fetch(`/api/currency-rates?to=${encodeURIComponent(currency)}`,{cache:'no-store'}).then(async response=>{
			const result=await response.json();
			if(!response.ok)throw new Error(result.error||'Exchange rate unavailable.');
			if(active)setRate(result as Rate);
		}).catch(exception=>{if(active)setError(exception instanceof Error?exception.message:'Exchange rate unavailable.')});
		return()=>{active=false};
	},[currency]);

	async function changeCurrency(value:string){
		setError('');
		try{
			const response=await fetch('/api/currency-preference',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({currency:value})});
			const result=await response.json();
			if(!response.ok)throw new Error(result.error||'Unable to save display currency.');
			setCurrency(result.currency);
		}catch(exception){setError(exception instanceof Error?exception.message:'Unable to save display currency.')}
	}

	return <section className="account-panel card p-4" aria-label="Display currency">
		<div className="grid gap-3 sm:grid-cols-[minmax(170px,220px)_1fr] sm:items-start">
			<label className="account-label">Preferred display currency<select className="input mt-1 min-h-11" value={currency} disabled={!ready} onChange={event=>void changeCurrency(event.target.value)}>{currencies.map(code=><option key={code}>{code}</option>)}</select></label>
			<div className="text-sm" aria-live="polite">
				{currency==='USD'
					?<p>Balances remain recorded in USD. Changing this preference never exchanges funds.</p>
					:currentRate!==null
						?<><p>Exchange rate: 1 USD = {currentRate.toLocaleString(undefined,{maximumSignificantDigits:10})} {currency}</p><div className="grid gap-1 sm:grid-cols-2">{values.map(({label,amount})=><p key={label}><span className="muted">{label}: </span>{amount===null?'Unavailable':`${money(Number(amount)*currentRate,currency)} approximate`} <span className="text-xs muted">(original: {amount===null?'Unavailable':money(Number(amount),'USD')})</span></p>)}</div><p className="mt-2 text-xs muted">{rate?.status==='INTERNAL'?'Internal reference rate · ':rate?.status==='STALE'?'Last known rate · may be outdated · ':''}Display conversion only · {rate?.source} · {rate?.observedAt?`updated ${new Date(rate.observedAt).toLocaleString()}`:'no provider timestamp'}</p></>
						:<p className="text-xs text-amber-200">{rate===null&&!error?'Loading exchange rate…':error||'A reference exchange rate is unavailable.'}</p>}
				{error&&<p className="mt-1 text-xs text-loss" role="alert">{error}</p>}
			</div>
		</div>
	</section>;
}

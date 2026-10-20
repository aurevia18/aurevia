'use client';

import {FormEvent,useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {useSession} from 'next-auth/react';
import {ArrowUpRight,RefreshCw,ShieldCheck} from 'lucide-react';
import Nav from '@/components/Nav';
import {useLocale} from '@/lib/i18n-context';
import {formatUsd} from '@/lib/currency-format';

type Opportunity={id:string;title:string;category:string;description:string;assetSymbol:string|null;minimumAmount:string;maximumAmount:string|null;targetReturnPercent:string|null;durationDays:number;startsAt:string|null;maturesAt:string|null;riskLevel:string;status:string;demoEligible:boolean;realEligible:boolean;requiresApproval:boolean;targetPrice:string|null;stopPrice:string|null};
type Request={id:string;opportunityId:string;accountMode:'DEMO'|'REAL';amount:string;status:string;requestedAt:string;activatedAt:string|null;maturesAt:string|null;settlementReference:string|null;simulatedPayout:string|null;opportunity:{title:string;category:string;riskLevel:string;targetReturnPercent:string|null;durationDays:number}};
type Payload={accountMode:'DEMO'|'REAL';availableBalance:string;opportunities:Opportunity[];requests:Request[]};

function amount(value:string|number|null|undefined,notSet:string){return value===null||value===undefined?notSet:formatUsd(value);}
function statusText(value:string){return value.replaceAll('_',' ');}
function dateText(value:string|null,notSet:string){return value?new Date(value).toLocaleDateString():notSet;}

export default function InvestmentExperience(){
 const {data:session}=useSession();
 const {translate}=useLocale();
 const [data,setData]=useState<Payload|null>(null);
 const [amounts,setAmounts]=useState<Record<string,string>>({});
 const [search,setSearch]=useState('');
 const [category,setCategory]=useState('ALL');
 const [confirmOpportunityId,setConfirmOpportunityId]=useState('');
 const [loading,setLoading]=useState(true);
 const [busy,setBusy]=useState('');
 const [error,setError]=useState('');
 const [notice,setNotice]=useState('');
 const latestRequest=useRef(0);

 const load=useCallback(async(showLoading=false)=>{
  const requestId=++latestRequest.current;
  if(showLoading)setLoading(true);
  try{
   const response=await fetch('/api/investments',{cache:'no-store'});
   const result=await response.json();
   if(!response.ok)throw new Error(result.error||translate('unableToLoadInvestments'));
   if(requestId===latestRequest.current){setData(result);setError('');}
  }catch(exception){if(requestId===latestRequest.current)setError(exception instanceof Error?exception.message:translate('unableToLoadInvestments'));}
  finally{if(requestId===latestRequest.current)setLoading(false);}
 },[translate]);
 const categories=useMemo(()=>[...new Set(data?.opportunities.map(item=>item.category)||[])].sort(),[data?.opportunities]);
 const visibleOpportunities=useMemo(()=>{
  const query=search.trim().toLowerCase();
  return (data?.opportunities||[]).filter(item=>(category==='ALL'||item.category===category)&&(!query||`${item.title} ${item.category} ${item.description} ${item.assetSymbol||''}`.toLowerCase().includes(query)));
 },[category,data?.opportunities,search]);

 useEffect(()=>{
  setData(null);setAmounts({});setConfirmOpportunityId('');setError('');setNotice('');
  void load(true);
  const refreshWhenActive=()=>{if(document.visibilityState==='visible')void load();};
  const timer=window.setInterval(refreshWhenActive,5_000);
  window.addEventListener('focus',refreshWhenActive);
  document.addEventListener('visibilitychange',refreshWhenActive);
  return ()=>{window.clearInterval(timer);window.removeEventListener('focus',refreshWhenActive);document.removeEventListener('visibilitychange',refreshWhenActive);};
 },[load,session?.user?.accountMode]);

 function reviewAllocation(event:FormEvent<HTMLFormElement>,opportunity:Opportunity){
  event.preventDefault();if(busy)return;
  const value=Number(amounts[opportunity.id]);
  if(!Number.isFinite(value)||value<=0){setError(translate('validInvestmentAmount'));return;}
  if(value<Number(opportunity.minimumAmount)||opportunity.maximumAmount&&value>Number(opportunity.maximumAmount)){setError('Enter an amount within this opportunity’s configured limits.');return;}
  if(data&&value>Number(data.availableBalance)){setError('The allocation cannot exceed your available account balance.');return;}
  setConfirmOpportunityId(opportunity.id);setError('');setNotice('');
 }

 async function confirmAllocation(opportunity:Opportunity){
  if(busy)return;
  const value=Number(amounts[opportunity.id]);
  if(!Number.isFinite(value)||value<=0){setError(translate('validInvestmentAmount'));return;}
  setBusy(opportunity.id);setError('');setNotice('');
  try{
   const response=await fetch('/api/investments',{method:'POST',headers:{'content-type':'application/json','Idempotency-Key':crypto.randomUUID()},body:JSON.stringify({opportunityId:opportunity.id,amount:value})});
   const result=await response.json();
   if(!response.ok)throw new Error(result.error||translate('unableToSubmitInvestment'));
   if(data){
    const submitted:Request={id:result.id,opportunityId:opportunity.id,accountMode:result.accountMode||data.accountMode,amount:result.amount||String(value),status:result.status,requestedAt:result.requestedAt||new Date().toISOString(),activatedAt:result.activatedAt||null,maturesAt:result.maturesAt||null,settlementReference:result.settlementReference||null,simulatedPayout:result.simulatedPayout||null,opportunity:{title:opportunity.title,category:opportunity.category,riskLevel:opportunity.riskLevel,targetReturnPercent:opportunity.targetReturnPercent,durationDays:opportunity.durationDays}};
    setData(current=>current?{...current,requests:[submitted,...current.requests.filter(item=>item.id!==submitted.id)]}:current);
   }
   setNotice(`${data?.accountMode||'Account'} simulated investment request recorded.`);
   setAmounts(current=>({...current,[opportunity.id]:''}));
   setConfirmOpportunityId('');
   await load();
  }catch(exception){setError(exception instanceof Error?exception.message:translate('unableToSubmitInvestment'));}
  finally{setBusy('');}
 }

 function reinvestPrincipal(request:Request){
  if(!data)return;
  const opportunity=data.opportunities.find(item=>item.id===request.opportunityId);
  if(!opportunity){setNotice('This opportunity is no longer available. Choose another currently available simulated opportunity.');return;}
  const returnedPrincipal=Number(request.simulatedPayout??request.amount);
  const available=Number(data.availableBalance);
  if(!Number.isFinite(returnedPrincipal)||returnedPrincipal<=0||!Number.isFinite(available)||available<=0){setError('No available returned principal can be selected for reinvestment.');return;}
  const allocation=Math.min(returnedPrincipal,available,opportunity.maximumAmount?Number(opportunity.maximumAmount):available);
  if(allocation<Number(opportunity.minimumAmount)){setError('The available returned principal is below this opportunity’s minimum allocation.');return;}
  setError('');
  setAmounts(current=>({...current,[opportunity.id]:allocation.toFixed(2)}));
  setNotice(`${amount(allocation,translate('investmentNotSet'))} of the returned simulated payout selected for reinvestment. It may include previously settled simulated earnings; review and confirm the new allocation separately.`);
  document.getElementById('opportunities')?.scrollIntoView({behavior:'smooth',block:'start'});
 }

 return <><Nav/><main className="account-page">
  <header className="account-heading"><div><span className="account-kicker">{translate('investmentsKicker')}</span><h1>{translate('investmentsTitle')}</h1><p>{translate('investmentSubtitle')}</p></div><span className={`status-pill ${data?.accountMode==='REAL'?'mode-real':'mode-demo'}`}>{data?translate('portfolioAccount',{mode:data.accountMode}):translate('investmentLoadingAccount')}</span></header>
  {data&&<div className="account-callout mb-4" role="status"><span>{data.accountMode} investment activity is simulated. Requests reserve available internal ledger funds. Configured targets are estimates only; no return is guaranteed or credited as earnings.</span></div>}
  {notice&&<p className="mb-3 text-sm text-profit" role="status">{notice}</p>}{error&&<div className="account-callout mb-3" role="alert"><span>{error}</span><button type="button" className="text-link" onClick={()=>void load(true)}><RefreshCw size={14}/> Retry</button></div>}
  <section id="opportunities" className="account-panel card p-5"><div className="account-panel-title"><div><h2>{translate('availableOpportunities')}</h2><p className="account-panel-subtitle">{translate('targetFigures')}</p></div>{data&&<span className="muted text-sm">{translate('availableCashLabel')} {amount(data.availableBalance,translate('investmentNotSet'))}</span>}</div>
   {data&&data.opportunities.length>0&&<div className="investment-opportunity-filters"><label className="account-label">Search opportunities<input className="input" type="search" value={search} onChange={event=>setSearch(event.target.value)} placeholder="Name, category or asset"/></label><label className="account-label">Category<select className="input" value={category} onChange={event=>setCategory(event.target.value)}><option value="ALL">All categories</option>{categories.map(item=><option key={item}>{item}</option>)}</select></label></div>}
   {loading&&!data?<p className="account-empty" role="status">{translate('loadingOpportunities')}</p>:data?.opportunities.length&&visibleOpportunities.length?<div className="mt-4 grid gap-4 lg:grid-cols-2">{visibleOpportunities.map(opportunity=>{
    const value=Number(amounts[opportunity.id]||0);const target=opportunity.targetReturnPercent===null?null:value*(1+Number(opportunity.targetReturnPercent)/100);
    return <article className="investment-opportunity" key={opportunity.id}>
     <div className="flex flex-wrap items-start justify-between gap-3"><div><span className="account-kicker">{opportunity.category}{opportunity.assetSymbol?` · ${opportunity.assetSymbol}`:''}</span><h3>{opportunity.title}</h3></div><span className="status-pill">{opportunity.riskLevel.replaceAll('_',' ')}</span></div>
     <p className="investment-description">{opportunity.description}</p>
     <dl className="investment-terms"><div><dt>{translate('minimum')}</dt><dd>{amount(opportunity.minimumAmount,translate('investmentNotSet'))}</dd></div><div><dt>{translate('maximum')}</dt><dd>{amount(opportunity.maximumAmount,translate('investmentNotSet'))}</dd></div><div><dt>{translate('duration')}</dt><dd>{translate('durationDays',{days:opportunity.durationDays})}</dd></div><div><dt>{translate('start')}</dt><dd>{dateText(opportunity.startsAt,translate('setOnActivation'))}</dd></div><div><dt>{translate('maturity')}</dt><dd>{dateText(opportunity.maturesAt,translate('setOnActivation'))}</dd></div><div><dt>{translate('targetReturn')}</dt><dd>{opportunity.targetReturnPercent===null?translate('notSpecified'):translate('targetPercent',{percent:Number(opportunity.targetReturnPercent).toFixed(2)})}</dd></div></dl>
     {(opportunity.targetPrice||opportunity.stopPrice)&&<p className="investment-levels">{translate('referenceLevels')}: {translate('targetReturn')} {amount(opportunity.targetPrice,translate('investmentNotSet'))} · {translate('stopPrice')} {amount(opportunity.stopPrice,translate('investmentNotSet'))}</p>}
     <form className="investment-request-form" onSubmit={event=>reviewAllocation(event,opportunity)}><label className="account-label">{translate('amountUsd')}<input className="input" inputMode="decimal" type="number" min={Number(opportunity.minimumAmount)} max={opportunity.maximumAmount?Number(opportunity.maximumAmount):undefined} step="0.01" required value={amounts[opportunity.id]||''} onChange={event=>{setConfirmOpportunityId('');setAmounts(current=>({...current,[opportunity.id]:event.target.value}));}}/></label><div className="investment-projection"><span>{translate('illustrativeTarget')}</span><b>{target===null?translate('unavailableTarget'):amount(target,translate('unavailableTarget'))}</b><small>{translate('projectionOnly')}</small></div><button className="btn bg-gold text-black" disabled={busy===opportunity.id||!data}>{busy===opportunity.id?translate('submitting'):'Review allocation'} <ArrowUpRight size={15}/></button><button type="button" className="text-link" onClick={()=>setAmounts(current=>({...current,[opportunity.id]:String(Math.min(Number(data?.availableBalance||0),opportunity.maximumAmount?Number(opportunity.maximumAmount):Number(data?.availableBalance||0)).toFixed(2))}))} disabled={!data||Number(data.availableBalance)<Number(opportunity.minimumAmount)}>Use available balance</button></form>
     {confirmOpportunityId===opportunity.id&&<div className="investment-confirmation" role="group" aria-label={`Review ${opportunity.title} allocation`}><p>Review allocation: <b>{amount(value,translate('investmentNotSet'))}</b> from your {data?.accountMode} account to <b>{opportunity.title}</b>. The server will recheck your balance, minimum, maximum and eligibility before reserving funds.</p><p>{target===null?'No target estimate is configured.':`Illustrative target ${amount(target,translate('unavailableTarget'))}; this is an estimate only and will not be recorded as earnings.`}</p><div><button type="button" className="btn bg-white/5" onClick={()=>setConfirmOpportunityId('')} disabled={busy===opportunity.id}>Edit allocation</button><button type="button" className="btn bg-gold text-black" onClick={()=>void confirmAllocation(opportunity)} disabled={busy===opportunity.id}>{busy===opportunity.id?translate('submitting'):'Confirm simulated allocation'}</button></div></div>}
     <p className="investment-disclosure"><ShieldCheck size={14}/> Simulated account activity only. No external investment is placed.</p>
    </article>;
   })}</div>:data?.opportunities.length?<p className="account-empty">No opportunities match these filters.</p>:<p className="account-empty">{translate('noOpportunities')}</p>}
  </section>
  <section className="account-panel card p-5 mt-4"><div className="account-panel-title"><div><h2>{translate('investmentActivity')}</h2><p className="account-panel-subtitle">{translate('privateToAccountMode')}</p></div><button type="button" className="text-link" onClick={()=>void load(true)}><RefreshCw size={14}/> {translate('investmentRefresh')}</button></div>
   {data?.requests.length?<div className="investment-request-list">{data.requests.map(item=><article className="investment-request-row" key={item.id}><div><b>{item.opportunity.title}</b><span>{item.opportunity.category} · {amount(item.amount,translate('investmentNotSet'))} · {item.accountMode}</span><small>{translate('investmentRequestStatus',{date:new Date(item.requestedAt).toLocaleString(),maturity:item.maturesAt?translate('maturityStatus',{date:new Date(item.maturesAt).toLocaleDateString()}):''})}</small>{item.simulatedPayout!==null&&<small>Persisted simulated payout: {amount(item.simulatedPayout,translate('investmentNotSet'))}; estimated return is not wallet cash.</small>}{item.settlementReference&&<small>{translate('referenceRecorded',{reference:item.settlementReference})}{item.accountMode==='REAL'?translate('notIndependentlyVerified'):''}</small>}{item.status==='SETTLED'&&<button type="button" className="text-link mt-2" onClick={()=>reinvestPrincipal(item)} disabled={!data.opportunities.some(opportunity=>opportunity.id===item.opportunityId)}>Reinvest returned principal · simulated</button>}</div><span className={`status-pill ${item.accountMode==='DEMO'?'mode-demo':'mode-real'}`}>{statusText(item.status)}</span></article>)}</div>:<p className="account-empty">{translate('noInvestmentRequests')}</p>}
  </section>
 </main></>;
}
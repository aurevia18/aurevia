'use client';

import {FormEvent,useCallback,useEffect,useMemo,useState} from 'react';
import {ArrowDownRight,ArrowUpRight,LoaderCircle,RefreshCw,TrendingUp} from 'lucide-react';
import {formatUsd} from '@/lib/currency-format';

type CryptoInstrument={id:string;symbol:string;name:string;baseAsset:string;quoteAsset:string;price:number|string;takerFee:number|string;updatedAt:string;lastUpdatedAt?:string};
type CryptoPosition={side:string;quantity:number|string;instrument:{id:string}};
const cryptoBases=new Set(['AUR','BTC','ETH']);
const priceFormat=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:8});

export default function DashboardCryptoTrade({accountMode,cash,onTradeComplete}:{accountMode:'DEMO'|'REAL';cash:string|null;onTradeComplete:()=>void|Promise<void>}){
 const [instruments,setInstruments]=useState<CryptoInstrument[]>([]);
 const [positions,setPositions]=useState<CryptoPosition[]>([]);
 const [selectedId,setSelectedId]=useState('');
 const [side,setSide]=useState<'BUY'|'SELL'>('BUY');
 const [quantity,setQuantity]=useState('0.01');
 const [loading,setLoading]=useState(true);
 const [submitting,setSubmitting]=useState(false);
 const [error,setError]=useState('');
 const [notice,setNotice]=useState('');

 const load=useCallback(async()=>{
  try{
   const [marketResponse,positionResponse]=await Promise.all([fetch('/api/market',{cache:'no-store'}),fetch('/api/positions',{cache:'no-store'})]);
   const [marketResult,positionResult]=await Promise.all([marketResponse.json(),positionResponse.json()]);
   if(!marketResponse.ok)throw new Error(marketResult.error||'Simulated crypto prices are unavailable.');
   if(!positionResponse.ok)throw new Error(positionResult.error||`${accountMode} positions are unavailable.`);
   const nextInstruments=(marketResult as CryptoInstrument[]).filter(item=>cryptoBases.has(item.baseAsset)&&item.quoteAsset==='USD');
   setInstruments(nextInstruments);
   setSelectedId(current=>nextInstruments.some(item=>item.id===current)?current:nextInstruments[0]?.id||'');
   setPositions(positionResult as CryptoPosition[]);
   setError('');
  }catch(exception){setError(exception instanceof Error?exception.message:'Unable to load simulated crypto trading.');}
  finally{setLoading(false);}
 },[accountMode]);

 useEffect(()=>{
  void load();
  const timer=window.setInterval(()=>void load(),10_000);
  return()=>window.clearInterval(timer);
 },[load]);

 const selected=instruments.find(item=>item.id===selectedId);
 const amount=Number(quantity);
 const notional=selected&&Number.isFinite(amount)?Number(selected.price)*amount:0;
 const fee=notional*Number(selected?.takerFee||0);
 const availableCash=Number(cash||0);
 const heldQuantity=useMemo(()=>positions.filter(position=>position.instrument.id===selectedId&&position.side==='BUY').reduce((total,position)=>total+Number(position.quantity),0),[positions,selectedId]);
 const invalidQuantity=!Number.isFinite(amount)||amount<=0;
 const exceedsCash=side==='BUY'&&notional+fee>availableCash;
 const exceedsPosition=side==='SELL'&&amount>heldQuantity;

 async function submit(event:FormEvent<HTMLFormElement>){
  event.preventDefault();
  if(!selected||submitting||invalidQuantity||exceedsCash||exceedsPosition)return;
  setSubmitting(true);setError('');setNotice('');
  try{
   const observedAt=selected.lastUpdatedAt||selected.updatedAt;
   const response=await fetch('/api/orders',{method:'POST',headers:{'content-type':'application/json','Idempotency-Key':window.crypto.randomUUID()},body:JSON.stringify({instrumentId:selected.id,side,type:'MARKET',quantity:amount,expectedPrice:Number(selected.price),observedAt})});
   const result=await response.json();
   if(!response.ok)throw new Error(result.error||'The simulated order was rejected.');
   setNotice(`${side==='BUY'?'Bought':'Sold'} ${amount} ${selected.baseAsset} in ${accountMode}. ${String(result.status||'').replaceAll('_',' ')}.`);
   await load();
   await onTradeComplete();
  }catch(exception){setError(exception instanceof Error?exception.message:'Unable to submit the simulated order.');}
  finally{setSubmitting(false);}
 }

 return <section className="dashboard-panel card dashboard-crypto-trade" aria-labelledby="dashboard-crypto-title">
  <div className="dashboard-panel-title"><div><h2 id="dashboard-crypto-title"><TrendingUp size={15} className="gold"/>Simulated crypto trading</h2><p>Market orders use your {accountMode} simulated cash and positions.</p></div><span className={`status-pill ${accountMode==='DEMO'?'mode-demo':'mode-real'}`}>{accountMode} · SIMULATED</span></div>
  {loading?<div className="crypto-trade-loading" role="status"><LoaderCircle size={16} className="animate-spin"/>Loading simulated prices</div>:!instruments.length?<div className="dashboard-empty"><div><b>No simulated crypto instruments available</b><p>Check back when crypto markets are enabled.</p></div></div>:<form className="crypto-trade-form" onSubmit={submit}>
   <div className="crypto-trade-market"><label>Crypto<select className="input" value={selectedId} onChange={event=>setSelectedId(event.target.value)}>{instruments.map(item=><option key={item.id} value={item.id}>{item.baseAsset}/USD · {item.name}</option>)}</select></label><div><span>Simulated price</span><b>{selected?priceFormat.format(Number(selected.price)):'--'}</b></div></div>
   <div className="crypto-trade-controls"><div className="crypto-trade-side" role="group" aria-label="Trade side"><button type="button" className={side==='BUY'?'is-active':''} aria-pressed={side==='BUY'} onClick={()=>setSide('BUY')}><ArrowUpRight size={14}/>Buy</button><button type="button" className={side==='SELL'?'is-active is-sell':''} aria-pressed={side==='SELL'} onClick={()=>setSide('SELL')}><ArrowDownRight size={14}/>Sell</button></div><label>Quantity ({selected?.baseAsset||'crypto'})<input className="input" type="number" min="0.00000001" step="any" max={side==='SELL'?heldQuantity:undefined} value={quantity} onChange={event=>setQuantity(event.target.value)} inputMode="decimal" required/></label></div>
   <div className="crypto-trade-summary"><span>{accountMode} cash <b>{formatUsd(availableCash)}</b></span><span>Held <b>{heldQuantity.toLocaleString('en-US',{maximumFractionDigits:8})} {selected?.baseAsset||''}</b></span><span>Est. fee <b>{formatUsd(fee)}</b></span><span>{side==='BUY'?'Est. total':'Est. proceeds'} <b>{formatUsd(side==='BUY'?notional+fee:notional)}</b></span></div>
   {exceedsCash&&<p className="crypto-trade-error" role="status">Not enough {accountMode} simulated cash for this order and estimated fee.</p>}
   {exceedsPosition&&<p className="crypto-trade-error" role="status">You can sell up to your held {accountMode} quantity.</p>}
   {error&&<p className="crypto-trade-error" role="alert">{error}</p>}
   {notice&&<p className="crypto-trade-notice" role="status">{notice}</p>}
   <div className="crypto-trade-footer"><small>Positions can gain or lose value as simulated prices move. Selling realizes the simulated result.</small><button className="btn bg-gold text-black" type="submit" disabled={!selected||submitting||invalidQuantity||exceedsCash||exceedsPosition}>{submitting?'Submitting…':`${side==='BUY'?'Buy':'Sell'} ${selected?.baseAsset||'crypto'}`} {submitting?<LoaderCircle size={14} className="animate-spin"/>:null}</button><button className="crypto-trade-refresh" type="button" aria-label="Refresh crypto prices and positions" onClick={()=>void load()} disabled={submitting}><RefreshCw size={14}/></button></div>
  </form>}
 </section>;
}
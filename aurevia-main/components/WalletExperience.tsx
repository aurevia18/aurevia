'use client';

import {FormEvent,useCallback,useEffect,useMemo,useRef,useState} from 'react';
import Link from 'next/link';
import {useSession} from 'next-auth/react';
import {ArrowDownLeft,ArrowUpRight,Eye,EyeOff,RefreshCw,WalletCards} from 'lucide-react';
import Nav from '@/components/Nav';
import ReceiptGenerator,{type ReceiptData} from '@/components/ReceiptGenerator';
import {useLocale} from '@/lib/i18n-context';
import {SUPPORTED_CURRENCIES} from '@/lib/config/simulation';
import {formatUsd} from '@/lib/currency-format';

type PaymentMethod={id:string;name:string;currencies:string[];destination:string|null;instructions:string|null;minimumAmount:string|number;maximumAmount:string|number|null;depositEnabled:boolean;withdrawalEnabled:boolean;requiresNetwork:boolean;demoOnly:boolean};
type FundingRecord={id:string;type:'DEPOSIT'|'WITHDRAWAL';method:string;amount:number|string;creditedAmount?:number|string|null;creditedCurrency?:string|null;currency:string;status:string;accountMode:'DEMO'|'REAL';createdAt:string;reviewedAt?:string|null;verifiedAt?:string|null;settledAt?:string|null;settlementReference?:string|null;reviewedBy?:{name:string|null;email:string}|null;transactionReference?:string|null;destinationInfo?:string|null;beneficiaryInfo?:string|null;note?:string|null;adminNote?:string|null;previousBalance?:string|null;resultingBalance?:string|null;hasReceipt?:boolean;network?:string|null;user?:{name:string|null;email:string}};
type LedgerReceipt={id:string;reference:string;description:string;type:'CREDIT'|'DEBIT';amount:number|string;currency:string;createdAt:string};
type WalletData={accountMode:'DEMO'|'REAL';balance:number|string|null;withdrawableBalance?:number|string|null;balances:Array<{currency:string;balance:number|string}>;transactions:FundingRecord[];adminLedgerReceipts:LedgerReceipt[]};
type CurrencyRate={rate:number|string|null;source:string|null;observedAt:string|null;status:'CURRENT'|'STALE'|'INTERNAL'|'UNAVAILABLE'};
type PaymentMethodsResponse={methods:PaymentMethod[];fundingStatus:'SIMULATED'|'DEMO'|'AVAILABLE'|'MANUAL_REVIEW'|'NOT_CONFIGURED'|'DISABLED'|'ERROR';simulationAvailable?:boolean;supportedCurrencies?:readonly string[];simulatedBitcoinAddress?:string|null;realFundingAvailable:boolean;realWithdrawalAvailable:boolean;manualDepositReviewAvailable:boolean};
type KycData={kycStatus:string;documents:number;verificationProfileSubmitted:boolean;depositEnabled:boolean;withdrawalEnabled:boolean;accountRestricted:boolean;restrictionReason:string|null;canWithdraw?:boolean};

const money=(amount:number,currency='USD')=>currency==='USD'?formatUsd(amount):`${amount.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:8})} ${currency}`;
const statuses:Record<string,string>={PENDING:'Pending',PENDING_REVIEW:'Pending administrator review',PROCESSING:'Processing',APPROVED:'Approved · internal debit pending',COMPLETED:'Completed in ledger',FAILED:'Failed · reservation released',REVERSED:'Reversed',REJECTED:'Rejected',CANCELLED:'Cancelled'};
const receiptStatus=(status:string):ReceiptData['status']=>{
	switch(status){
		case 'PENDING':case 'PENDING_REVIEW':case 'PROCESSING':case 'APPROVED':case 'COMPLETED':case 'REJECTED':case 'FAILED':case 'CANCELLED':return status;
		case 'REVERSED':return 'CANCELLED';
		default:return 'PENDING';
	}
};
const reserves=['PENDING','PENDING_REVIEW','APPROVED','PROCESSING'];
const formatFundingMethodLabel=(method:string)=>{
	const value=String(method||'');
	if(/^Internal simulated\b/i.test(value))return value;
	return value.replace(/^Admin configured\s+/i,'Administrator ').replace(/\s+REAL deposit$/i,' Real Account deposit').replace(/\s+simulated\s+/i,' ');
};
const fundingUnavailableMessage=(status:PaymentMethodsResponse['fundingStatus'])=>status==='DISABLED'?'Internal ledger requests are temporarily disabled for this account. No balance was changed.':'Internal ledger requests are temporarily unavailable. No balance was changed.';
const validateFundingAmount=(amountText:string,mode:'DEPOSIT'|'WITHDRAWAL',balance:number|null,minimum:number|undefined,maximum:number|undefined)=>{
	const numeric=Number(amountText);
	if(!amountText.trim()||!Number.isFinite(numeric)||numeric<=0)return 'Enter a positive amount.';
	if(mode==='WITHDRAWAL'&&balance!==null&&numeric>balance)return 'Withdrawal amount cannot exceed the currently eligible withdrawal balance.';
	if(minimum!==undefined&&numeric<Number(minimum))return `Minimum allowed amount is ${money(Number(minimum), 'USD')}.`;
	if(maximum!==undefined&&numeric>Number(maximum))return `Maximum allowed amount is ${money(Number(maximum), 'USD')}.`;
	return '';
};

function isWalletData(value:unknown):value is WalletData{
	if(!value||typeof value!=='object')return false;
	const data=value as Partial<WalletData>;
	const validAmount=(amount:unknown)=>amount===null||(typeof amount==='number'&&Number.isFinite(amount))||(typeof amount==='string'&&amount.trim()!==''&&Number.isFinite(Number(amount)));
	return (data.accountMode==='DEMO'||data.accountMode==='REAL')&&validAmount(data.balance)&&(data.withdrawableBalance===undefined||validAmount(data.withdrawableBalance))&&Array.isArray(data.balances)&&data.balances.every(item=>!!item&&typeof item.currency==='string'&&validAmount(item.balance))&&Array.isArray(data.transactions)&&data.transactions.every(item=>!!item&&typeof item.id==='string'&&(item.type==='DEPOSIT'||item.type==='WITHDRAWAL')&&typeof item.status==='string'&&validAmount(item.amount))&&(data.adminLedgerReceipts===undefined||Array.isArray(data.adminLedgerReceipts));
}

function isPaymentMethodsResponse(value:unknown):value is PaymentMethodsResponse{
	if(!value||typeof value!=='object')return false;
	const data=value as Partial<PaymentMethodsResponse>;
	return Array.isArray(data.methods)&&data.methods.every(method=>!!method&&typeof method.id==='string'&&typeof method.name==='string'&&Array.isArray(method.currencies)&&method.currencies.every(currency=>typeof currency==='string')&&typeof method.depositEnabled==='boolean'&&typeof method.withdrawalEnabled==='boolean')&&['SIMULATED','DEMO','AVAILABLE','MANUAL_REVIEW','NOT_CONFIGURED','DISABLED','ERROR'].includes(String(data.fundingStatus))&&typeof data.realFundingAvailable==='boolean'&&typeof data.realWithdrawalAvailable==='boolean'&&typeof data.manualDepositReviewAvailable==='boolean';
}

export default function WalletExperience(){
	const {data:session,status:sessionStatus}=useSession();
	const {translate}=useLocale();
	const activeMode=session?.user?.accountMode;
	const [data,setData]=useState<WalletData>({accountMode:'DEMO',balance:0,balances:[],transactions:[],adminLedgerReceipts:[]});
	const [methods,setMethods]=useState<PaymentMethod[]>([]);
	const [fundingStatus,setFundingStatus]=useState<PaymentMethodsResponse['fundingStatus']>('NOT_CONFIGURED');
	const [realFundingAvailable,setRealFundingAvailable]=useState(false);
	const [realWithdrawalAvailable,setRealWithdrawalAvailable]=useState(false);
	const [manualDepositReviewAvailable,setManualDepositReviewAvailable]=useState(false);
	const [profile,setProfile]=useState<KycData|null>(null);
	const [methodLoadError,setMethodLoadError]=useState('');
	const [profileLoadError,setProfileLoadError]=useState('');
	const [type,setType]=useState<'DEPOSIT'|'WITHDRAWAL'>('DEPOSIT');
	const [methodId,setMethodId]=useState('');
	const [currency,setCurrency]=useState('USD');
	const [amount,setAmount]=useState('');
	const [transactionReference,setTransactionReference]=useState('');
	const [note,setNote]=useState('');
	const [confirming,setConfirming]=useState(false);
	const [message,setMessage]=useState('');
	const [error,setError]=useState('');
	const [loading,setLoading]=useState(true);
	const [hasWalletData,setHasWalletData]=useState(false);
	const [balanceVisible,setBalanceVisible]=useState(true);
	const [submitting,setSubmitting]=useState(false);
	const currencyPreferenceInitialized=useRef(false);
	const latestRequest=useRef(0);
	const [idempotencyKey,setIdempotencyKey]=useState('');
	const [keyFingerprint,setKeyFingerprint]=useState('');
	const [receiptFiles,setReceiptFiles]=useState<Record<string,File|undefined>>({});
	const [receiptBusy,setReceiptBusy]=useState('');
	const [submittedReceipt,setSubmittedReceipt]=useState<FundingRecord|null>(null);
	const [proofFile,setProofFile]=useState<File|null>(null);
	const [displayCurrency,setDisplayCurrency]=useState('USD');
	const [currencyRate,setCurrencyRate]=useState<CurrencyRate|null>(null);
	const [currencyError,setCurrencyError]=useState('');

	const availableMethods=useMemo(()=>methods.filter(method=>type==='DEPOSIT'?method.depositEnabled:method.withdrawalEnabled&&(data.accountMode==='DEMO'||realWithdrawalAvailable)),[methods,type,data.accountMode,realWithdrawalAvailable]);
	const selectedMethod=availableMethods.find(method=>method.id===methodId);
	const manualRealRequest=data.accountMode==='REAL';
	const manualRealDeposit=type==='DEPOSIT'&&manualRealRequest;
	const manualRealWithdrawal=type==='WITHDRAWAL'&&manualRealRequest;
	const manualRealFunding=manualRealDeposit||manualRealWithdrawal;
	const currentBalanceRecord=data.balances.find(item=>item.currency===currency);
	const currentBalance=currentBalanceRecord?Number(currentBalanceRecord.balance):null;
	const pendingWithdrawal=useMemo(()=>data.transactions.filter(item=>item.type==='WITHDRAWAL'&&item.currency===currency&&reserves.includes(item.status)).reduce((sum,item)=>sum+Number(item.amount),0),[data.transactions,currency]);
	const ledgerAvailableBalance=currentBalance===null?null:currentBalance-pendingWithdrawal;
	const availableBalance=data.accountMode==='REAL'&&currency==='USD'
		?(data.withdrawableBalance===undefined||data.withdrawableBalance===null?null:Number(data.withdrawableBalance))
		:ledgerAvailableBalance;
	const currentDisplayRate=currencyRate?.rate!==null&&currencyRate?.rate!==undefined&&Number.isFinite(Number(currencyRate.rate))&&Number(currencyRate.rate)>0?Number(currencyRate.rate):null;
	const realKycApproved=profile?.kycStatus==='APPROVED'&&profile.documents>0&&profile.verificationProfileSubmitted;
	const realWithdrawalBlocked=data.accountMode==='REAL'&&!!profile&&(!profile.withdrawalEnabled||profile.accountRestricted);
	const load=useCallback(async(showLoading=false)=>{
		const requestId=++latestRequest.current;
		if(showLoading)setLoading(true);
		setError('');
		const requests=await Promise.allSettled([
			fetch('/api/wallet',{cache:'no-store'}).then(async response=>({response,result:await response.json()})),
			fetch('/api/payment-methods',{cache:'no-store'}).then(async response=>({response,result:await response.json()})),
			fetch('/api/profile',{cache:'no-store'}).then(async response=>({response,result:await response.json()})),
			fetch('/api/currency-preference',{cache:'no-store'}).then(async response=>({response,result:await response.json()})),
		]);
		if(requestId!==latestRequest.current)return;
		const [walletRequest,methodsRequest,profileRequest,currencyPreferenceRequest]=requests;
		if(walletRequest.status==='fulfilled'&&walletRequest.value.response.ok&&isWalletData(walletRequest.value.result)){
			setData({...walletRequest.value.result,adminLedgerReceipts:walletRequest.value.result.adminLedgerReceipts||[]});setHasWalletData(true);
		}else{
			const result=walletRequest.status==='fulfilled'?walletRequest.value.result as {error?:string}:null;
			setData(current=>({...current,balance:null,balances:[],transactions:[]}));
			setHasWalletData(false);
			setError(result?.error||'Wallet data is temporarily unavailable. Please try again.');
		}
		if(methodsRequest.status==='fulfilled'&&methodsRequest.value.response.ok&&isPaymentMethodsResponse(methodsRequest.value.result)){
			setMethods(methodsRequest.value.result.methods);
			setFundingStatus(methodsRequest.value.result.fundingStatus);
			setRealFundingAvailable(methodsRequest.value.result.realFundingAvailable);
			setRealWithdrawalAvailable(methodsRequest.value.result.realWithdrawalAvailable);
			setManualDepositReviewAvailable(methodsRequest.value.result.manualDepositReviewAvailable);
			setMethodLoadError('');
		}else{
			const result=methodsRequest.status==='fulfilled'?methodsRequest.value.result as {error?:string}:null;
			setMethods([]);setFundingStatus('ERROR');setRealFundingAvailable(false);setRealWithdrawalAvailable(false);setManualDepositReviewAvailable(false);
			setMethodLoadError(result?.error||'Funding options are temporarily unavailable. No funds were changed.');
		}
		if(profileRequest.status==='fulfilled'&&profileRequest.value.response.ok&&profileRequest.value.result&&typeof profileRequest.value.result==='object'){
			setProfile(profileRequest.value.result);setProfileLoadError('');
		}else{
			setProfile(null);setProfileLoadError('Account verification status is temporarily unavailable.');
		}
		if(!currencyPreferenceInitialized.current&&currencyPreferenceRequest.status==='fulfilled'&&currencyPreferenceRequest.value.response.ok&&typeof currencyPreferenceRequest.value.result.currency==='string'){
			const preferred=currencyPreferenceRequest.value.result.currency;
			setDisplayCurrency(preferred);
			if(SUPPORTED_CURRENCIES.some(item=>item===preferred))setCurrency(preferred);
			currencyPreferenceInitialized.current=true;
		}
		setLoading(false);
	},[]);

	useEffect(()=>{
		if(displayCurrency==='USD'){setCurrencyRate(null);setCurrencyError('');return}
		let current=true;
		setCurrencyRate(null);setCurrencyError('');
		void fetch(`/api/currency-rates?to=${encodeURIComponent(displayCurrency)}`,{cache:'no-store'}).then(async response=>{
			const result=await response.json();
			if(!response.ok)throw new Error(result.error||'Exchange rate unavailable.');
			if(current){setCurrencyRate(result);setCurrencyError('')}
		}).catch(()=>{if(current){setCurrencyRate({rate:null,source:null,observedAt:null,status:'UNAVAILABLE'});setCurrencyError('')}})
		return()=>{current=false};
	},[displayCurrency]);
	async function updateDisplayCurrency(value:string){
		setCurrencyError('');
		try{
			const response=await fetch('/api/currency-preference',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({currency:value})});
			const result=await response.json();
			if(!response.ok)throw new Error(result.error||'Unable to save display currency.');
			setDisplayCurrency(result.currency);
		}catch(exception){setCurrencyError(exception instanceof Error?exception.message:'Unable to save display currency.')}
	}

	useEffect(()=>{
		if(sessionStatus!=='authenticated')return;
		setData({accountMode:activeMode||'DEMO',balance:0,balances:[],transactions:[],adminLedgerReceipts:[]});
		setMethods([]);setMethodId('');setFundingStatus('NOT_CONFIGURED');setRealFundingAvailable(false);setRealWithdrawalAvailable(false);setManualDepositReviewAvailable(false);setProfile(null);setMethodLoadError('');setProfileLoadError('');setHasWalletData(false);setSubmittedReceipt(null);setAmount('');setTransactionReference('');setNote('');setProofFile(null);setIdempotencyKey('');setKeyFingerprint('');setConfirming(false);setMessage('');setReceiptFiles({});
		void load(true);
	},[sessionStatus,activeMode,load]);
	useEffect(()=>{
		if(new URLSearchParams(window.location.search).get('type')==='WITHDRAWAL')setType('WITHDRAWAL');
	},[]);
	useEffect(()=>{
		if(sessionStatus!=='authenticated')return;
		const timer=window.setInterval(()=>void load(),15000);
		const refreshWhenActive=()=>{if(document.visibilityState==='visible')void load()};
		window.addEventListener('focus',refreshWhenActive);
		document.addEventListener('visibilitychange',refreshWhenActive);
		return ()=>{window.clearInterval(timer);window.removeEventListener('focus',refreshWhenActive);document.removeEventListener('visibilitychange',refreshWhenActive)};
	},[sessionStatus,load]);
	useEffect(()=>{
		if(methodId!=='SIMULATED_REAL'&&!availableMethods.some(method=>method.id===methodId))setMethodId(availableMethods[0]?.id||'');
	},[availableMethods,methodId]);
	useEffect(()=>{if(currency!=='USD')setCurrency('USD')},[currency]);

	async function submit(event:FormEvent<HTMLFormElement>){
		event.preventDefault();
		if(!selectedMethod&&!manualRealFunding)return;
		const minimumAmount=selectedMethod&&selectedMethod.minimumAmount!==null&&selectedMethod.minimumAmount!==undefined?Number(selectedMethod.minimumAmount):0.01;
		const minAmount=type==='DEPOSIT'?minimumAmount:undefined;
		const maxAmount=type==='WITHDRAWAL'?(selectedMethod&&selectedMethod.maximumAmount!==null&&selectedMethod.maximumAmount!==undefined?Number(selectedMethod.maximumAmount):undefined):undefined;
		const validationMessage=validateFundingAmount(amount,type,availableBalance,minAmount,maxAmount);
		if(validationMessage){setError(validationMessage);setConfirming(false);return;}
		setConfirming(true);setMessage('');setError('');
	}

	async function confirmSubmit(){
		if((!selectedMethod&&!manualRealFunding)||submitting)return;
		setSubmitting(true);setError('');
		const payload={type,amount:Number(amount),currency:'USD',transactionReference:transactionReference||undefined,note:note||undefined};
		const fingerprint=JSON.stringify(payload);
		const key=idempotencyKey&&keyFingerprint===fingerprint?idempotencyKey:window.crypto.randomUUID();setIdempotencyKey(key);setKeyFingerprint(fingerprint);
		try{
			const headers:HeadersInit={'Idempotency-Key':key};
			let body:BodyInit;
			if(type==='DEPOSIT'&&proofFile){
				const form=new FormData();
				form.append('payload',JSON.stringify(payload));
				form.append('evidence',proofFile);
				body=form;
			}else{
				headers['content-type']='application/json';
				body=JSON.stringify(payload);
			}
			const response=await fetch('/api/wallet',{method:'POST',headers,body});
			const result=await response.json();
			if(!response.ok)throw new Error(result.error||'Unable to submit this request.');
			setSubmittedReceipt(result as FundingRecord);
			setMessage(response.status===200?`Request ${result.id} already exists with status ${String(result.status).replaceAll('_',' ')}. No new request was created.`:`Request ${result.id} submitted for administrator review. The ledger has not been posted.`);
			setAmount('');setTransactionReference('');setNote('');setProofFile(null);setIdempotencyKey('');setKeyFingerprint('');setConfirming(false);
			await load();
		}catch(exception){setError(exception instanceof Error?exception.message:'Unable to submit this request.');}
		finally{setSubmitting(false);}
	}

	async function uploadReceipt(request:FundingRecord){
		const file=receiptFiles[request.id];if(!file||receiptBusy)return;
		setReceiptBusy(request.id);setError('');setMessage('');
		try{
			const body=new FormData();body.append('file',file);
			const response=await fetch(`/api/wallet/${encodeURIComponent(request.id)}/receipt`,{method:'POST',body});
			const result=await response.json();if(!response.ok)throw new Error(result.error||'Receipt upload failed.');
			const delivery=result.emailDelivery==='sent'?'Support email sent.':result.emailDelivery==='failed'?'Support email failed; admin notification is recorded.':'Email is not configured; admin notification is recorded.';
			setMessage(`Receipt stored privately. Funds were not credited. ${delivery}`);setReceiptFiles(current=>({...current,[request.id]:undefined}));await load();
		}catch(exception){setError(exception instanceof Error?exception.message:'Receipt upload failed.')}
		finally{setReceiptBusy('')}
	}

	async function openReceipt(requestId:string){
		try{
			const response=await fetch(`/api/wallet/${encodeURIComponent(requestId)}/receipt`,{cache:'no-store'});
			const result=await response.json();if(!response.ok)throw new Error(result.error||'Receipt unavailable.');
			window.open(result.url,'_blank','noopener,noreferrer');
		}catch(exception){setError(exception instanceof Error?exception.message:'Receipt unavailable.')}
	}

	return <><Nav/><main className="account-page">
		<header className="account-heading"><div><span className="account-kicker">{data.accountMode} ACCOUNT · {translate('walletHeader')}</span><h1>{translate('walletTitle')}</h1><p>{data.accountMode==='DEMO'?'DEMO uses a separate virtual wallet and simulated transactions.':'REAL account activity is recorded only in Aurevia’s internal ledger; no external payment or transfer is processed.'}</p></div><span className={`status-pill ${data.accountMode==='DEMO'?'mode-demo':'mode-real'}`}>{data.accountMode==='DEMO'?'DEMO · VIRTUAL':'REAL · INTERNAL LEDGER'}</span></header>
		{data.accountMode==='REAL'&&type==='DEPOSIT'&&!realKycApproved&&<div className="account-callout account-mode-notice"><span>{translate('verificationRequired')}</span><Link className="text-link" href="/kyc">{translate('openVerification')}</Link></div>}
		{realWithdrawalBlocked&&<div className="account-callout account-mode-notice"><span>{profile?.accountRestricted?translate('accountRestrictedNotice'):translate('withdrawalDisabled')}{profile?.restrictionReason?` ${profile.restrictionReason}`:''}</span><Link className="text-link" href="/support">{translate('contactSupportAction')}</Link></div>}
		{type==='DEPOSIT'&&profile?.depositEnabled===false&&<div className="account-callout account-mode-notice" role="status"><span>Deposits are disabled for your account. Contact an administrator for assistance.</span></div>}
		{type==='WITHDRAWAL'&&profile&&!profile.withdrawalEnabled&&!realWithdrawalBlocked&&<div className="account-callout account-mode-notice" role="status"><span>Withdrawals are disabled for your account by an administrator.</span></div>}
		{type==='WITHDRAWAL'&&profile?.canWithdraw===false&&!realWithdrawalBlocked&&profile.withdrawalEnabled&&<div className="account-callout account-mode-notice" role="status"><span>Withdrawals are available only after the first completed investment trade.</span></div>}
		{type==='WITHDRAWAL'&&data.accountMode==='REAL'&&<div className="account-callout account-mode-notice" role="status"><span>Withdrawal requests are checked against your REAL available ledger balance, including pending reservations. Administrator approval debits this internal balance once; no external transfer is initiated.</span></div>}
		{data.accountMode==='REAL'&&((type==='DEPOSIT'&&!realFundingAvailable&&!manualDepositReviewAvailable)||(type==='WITHDRAWAL'&&!realWithdrawalAvailable))&&<div className="account-callout account-mode-notice" role="status"><span>{fundingUnavailableMessage(fundingStatus)}</span></div>}
		{data.accountMode==='REAL'&&profileLoadError&&<div className="account-callout account-mode-notice" role="status"><span>{profileLoadError} REAL funding requests remain disabled until this status can be verified.</span></div>}
		<section className="wallet-balance-panel">
			<div className="wallet-balance-heading"><div className="account-kicker">{translate('availableBalances',{mode:data.accountMode.toLowerCase()})}</div><button type="button" className="wallet-balance-toggle" aria-label={balanceVisible?'Hide balances':'Show balances'} aria-pressed={!balanceVisible} onClick={()=>setBalanceVisible(value=>!value)}>{balanceVisible?<EyeOff size={16}/>:<Eye size={16}/>}<span>{balanceVisible?'Hide':'Show'}</span></button></div>
			<div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4">
				<div className="text-xs uppercase tracking-[0.18em] text-emerald-200/80">{data.accountMode==='DEMO'?'Internal virtual DEMO balance':'Aurevia REAL available ledger balance'}</div>
				<div className="wallet-balance-value mt-2 text-3xl font-semibold text-white">{loading?translate('loading'):!hasWalletData||data.balance===null?'Unavailable':balanceVisible?money(Number(data.balance),'USD'):'•••••• USD'}</div>
				<div className="mt-1 text-sm text-slate-300">USD account balance and pending review totals</div>
				{data.accountMode==='REAL'&&<div className="mt-3 border-t border-white/10 pt-3 text-sm text-slate-300">Available for withdrawal after pending reservations: <b className="text-white">{loading||!hasWalletData||data.withdrawableBalance===null||data.withdrawableBalance===undefined?'Unavailable':balanceVisible?money(Number(data.withdrawableBalance),'USD'):'•••••• USD'}</b><p className="mt-1 text-xs muted">Approval records an internal ledger debit only; it does not send money externally.</p></div>}
			</div>
			<p className="wallet-demo-note">{hasWalletData?translate('walletDemoNote'):'Balance could not be retrieved. No balance is assumed.'}</p>
			<div className="wallet-currency-list">{data.balances.filter(item=>item.currency!=='BTC').map(item=><span key={item.currency}>{balanceVisible?money(Number(item.balance),item.currency):`${item.currency} ••••••`}</span>)}</div>
			<div className="mt-4 grid gap-2 border-t border-white/10 pt-4 sm:grid-cols-[minmax(170px,220px)_1fr] sm:items-end">
				<label className="block text-xs muted">Preferred display currency<select className="input mt-1 min-h-11" value={displayCurrency} onChange={event=>void updateDisplayCurrency(event.target.value)}>{['USD','EUR','GBP','NGN','CAD','AUD','CHF','JPY'].map(code=><option key={code}>{code}</option>)}</select></label>
				<div className="text-sm" aria-live="polite">
					{displayCurrency==='USD'?<p>Original ledger amounts shown in their account currencies. Changing this preference never exchanges funds.</p>:currentDisplayRate!==null?<><p>Exchange rate: 1 USD = {currentDisplayRate.toLocaleString(undefined,{maximumSignificantDigits:10})} {displayCurrency}</p>{data.balance!==null&&<p>Approximate display: {balanceVisible?new Intl.NumberFormat(undefined,{style:'currency',currency:displayCurrency}).format(Number(data.balance)*currentDisplayRate):`•••••• ${displayCurrency}`} · Original ledger balance: {balanceVisible?money(Number(data.balance),'USD'):'•••••• USD'}</p>}<p className="mt-1 text-xs muted">{currencyRate?.status==='INTERNAL'?'Internal reference rate · ':currencyRate?.status==='STALE'?'Last known rate · may be outdated · ':''}Rate source: {currencyRate?.source} · {currencyRate?.observedAt?`Updated ${new Date(currencyRate.observedAt).toLocaleString()}`:'no provider timestamp'}. Display only; no ledger conversion.</p></>:<p className="text-xs text-amber-200">{currencyError||'A reference exchange rate is unavailable.'}</p>}
					{currencyError&&displayCurrency!=='USD'&&<p className="mt-1 text-xs text-loss" role="alert">{currencyError}</p>}
				</div>
			</div>
		</section>
		{error&&<p className="mt-3 text-sm text-loss" role="alert">{error}</p>}
		{message&&<p className="mt-3 text-sm text-profit" role="status">{message}</p>}
		<div className="account-metrics mt-3"><div className="account-metric"><span>{translate('pendingReview')}</span><b>{hasWalletData?data.transactions.filter(item=>reserves.includes(item.status)).length:'—'}</b><small>{translate('noLedgerPosting')}</small></div><div className="account-metric"><span>{translate('withdrawalReservations')}</span><b>{hasWalletData?availableBalance===null?'Unavailable':money(pendingWithdrawal,currency):'—'}</b><small>{translate('requestsAwaitingReview',{currency})}</small></div><div className="account-metric"><span>{translate('enabledPaymentMethods')}</span><b>{methodLoadError?'—':methods.length}</b><small>{translate('configuredByAdministrator')}</small></div><div className="account-metric"><span>{translate('recentRequests')}</span><b>{hasWalletData?data.transactions.length:'—'}</b><small>{translate('latest100')}</small></div></div>
		{submittedReceipt&&<section className="account-panel card mt-4 p-5"><div className="account-panel-title"><div><h2>Funding request receipt</h2><p className="account-panel-subtitle">Your generated receipt records the request and its current review status.</p></div></div><ReceiptGenerator receipt={{id:submittedReceipt.id,reference:submittedReceipt.id,status:receiptStatus(submittedReceipt.status),type:submittedReceipt.type,accountMode:submittedReceipt.accountMode,simulated:true,createdAt:submittedReceipt.createdAt,reviewedAt:submittedReceipt.reviewedAt,completedAt:submittedReceipt.settledAt,adminNote:submittedReceipt.adminNote,name:session?.user?.name||'',email:session?.user?.email||'',amount:submittedReceipt.amount,currency:submittedReceipt.currency,creditedAmount:submittedReceipt.creditedAmount??undefined,creditedCurrency:submittedReceipt.creditedCurrency,method:submittedReceipt.method,accountReference:`USER:${session?.user?.id||'account'}:${submittedReceipt.accountMode}:${submittedReceipt.currency}`,externalReference:submittedReceipt.transactionReference,recipientName:submittedReceipt.beneficiaryInfo,recipientNumber:submittedReceipt.destinationInfo,destinationNumber:submittedReceipt.destinationInfo,purpose:submittedReceipt.note}}/></section>}
		{data.transactions.length>0&&<section className="account-panel card mt-4 p-5"><div className="account-panel-title"><div><h2>Funding receipts</h2><p className="account-panel-subtitle">Download request and approval receipts for deposits and withdrawals recorded in this account.</p></div></div><div className="mt-4 grid gap-3">{data.transactions.slice(0,10).map(transaction=>{
			const name=transaction.user?.name||session?.user?.name||'';
			const email=transaction.user?.email||session?.user?.email||'';
			const common={id:transaction.id,accountMode:transaction.accountMode,accountReference:`USER:${session?.user?.id||'account'}:${transaction.accountMode}:${transaction.currency}`,createdAt:transaction.createdAt,name,email,amount:transaction.amount,currency:transaction.currency,creditedAmount:transaction.creditedAmount??undefined,creditedCurrency:transaction.creditedCurrency,method:formatFundingMethodLabel(transaction.method),externalReference:transaction.transactionReference,recipientName:transaction.beneficiaryInfo,recipientNumber:transaction.destinationInfo,destinationNumber:transaction.destinationInfo,purpose:transaction.note,simulated:true,previousBalance:transaction.previousBalance,resultingBalance:transaction.resultingBalance,adminNote:transaction.adminNote};
			return <details key={transaction.id} className="border-t border-white/10 pt-3"><summary className="min-h-11 cursor-pointer py-2 text-sm">{transaction.accountMode} internal {transaction.type.toLowerCase()} request · {money(Number(transaction.amount),transaction.currency)} · {statuses[transaction.status]||transaction.status}</summary><div className="grid min-w-0 gap-4 pt-3 xl:grid-cols-2"><ReceiptGenerator receipt={{...common,reference:transaction.settlementReference||transaction.id,status:receiptStatus(transaction.status),type:transaction.type,completedAt:transaction.settledAt,reviewedAt:transaction.reviewedAt,reviewedBy:transaction.reviewedBy}}/></div></details>;
		})}</div></section>}
		{data.adminLedgerReceipts.length>0&&<section className="account-panel card mt-4 p-5"><div className="account-panel-title"><div><h2>Administrator ledger receipts</h2><p className="account-panel-subtitle">Administrator credits are recorded in this account’s ledger and included in the account balance.</p></div></div><div className="mt-4 grid gap-3">{data.adminLedgerReceipts.map(transaction=><details key={transaction.id} className="border-t border-white/10 pt-3"><summary className="min-h-11 cursor-pointer py-2 text-sm">{transaction.type==='CREDIT'?'Administrator credit':'Administrator debit'} · {money(Number(transaction.amount),transaction.currency)} · {new Date(transaction.createdAt).toLocaleString()}</summary><div className="pt-3"><ReceiptGenerator receipt={{id:transaction.id,reference:transaction.reference,status:'COMPLETED',type:transaction.type==='CREDIT'?'CREDIT':'DEBIT',accountMode:data.accountMode,simulated:data.accountMode==='REAL',createdAt:transaction.createdAt,name:session?.user?.name||'',email:session?.user?.email||'',amount:transaction.amount,currency:transaction.currency,method:transaction.description}}/></div></details>)}</div></section>}
		<div className="account-content-grid">
			<section className="account-panel card p-5"><div className="account-panel-title"><div><h2>{translate('fundingRequest')}</h2><p className="account-panel-subtitle">{translate('fundingRequestSubtitle')}</p></div><WalletCards size={18} className="gold" aria-hidden="true"/></div>
				{data.accountMode==='DEMO'?<div className="account-callout account-mode-notice mt-4" role="status">Deposits and withdrawals are available in REAL Mode only.</div>:<>
				<div className="account-callout account-mode-notice mt-4" role="status"><span><strong>{type==='DEPOSIT'?'Internal REAL ledger credit request':'Internal REAL ledger withdrawal request'}</strong><br/>This workflow records requests only in Aurevia’s ledger. No external payment, blockchain verification, bank payout, or cryptocurrency transfer is processed. Your balance changes only after an authorized administrator approves the request. References and attachments, if provided, are user-submitted information and are not independently verified.</span></div>
				<div className="wallet-type-switch" role="group" aria-label={translate('fundingRequestType')}><button type="button" aria-pressed={type==='DEPOSIT'} onClick={()=>{setType('DEPOSIT');setConfirming(false)}}><ArrowDownLeft size={15}/> {translate('deposit')}</button><button type="button" aria-pressed={type==='WITHDRAWAL'} onClick={()=>{setType('WITHDRAWAL');setConfirming(false)}}><ArrowUpRight size={15}/> {translate('withdrawal')}</button></div>
				<form onSubmit={submit} className="mt-4 space-y-4">
					{(selectedMethod||manualRealFunding)&&<>
						<label className="account-label">{translate('amount',{currency:'USD'})}<input className="input" type="number" min="0.01" max="100000000" step="0.01" inputMode="decimal" required value={amount} onChange={event=>setAmount(event.target.value)} placeholder="0.00"/></label>
						{type==='DEPOSIT'?<>
							<label className="account-label">Request reference (optional)<input className="input" maxLength={180} value={transactionReference} onChange={event=>setTransactionReference(event.target.value)} placeholder="Internal reference or context"/></label>
							<label className="account-label">Optional attachment for administrator review<input className="input" type="file" accept="image/jpeg,image/png,image/webp" aria-label="Optional supporting attachment" onChange={event=>setProofFile(event.target.files?.[0]||null)}/><small className="muted">An attachment is user-submitted information only. It is not independently verified evidence of an external payment.</small></label>
						</>:<div className="account-callout"><span>Available REAL balance after pending reservations: {availableBalance===null?'Unavailable':money(availableBalance,'USD')}. Approval debits the internal ledger exactly once; no external destination is used.</span></div>}
						<label className="account-label">{translate('note')}<textarea className="input min-h-20" maxLength={500} value={note} onChange={event=>setNote(event.target.value)}/></label>
					</>}
					{!availableMethods.length&&!manualRealFunding&&<div className="account-empty" role="status">{methodLoadError||translate('noDepositMethods',{type:type.toLowerCase()})}</div>}
					{type==='DEPOSIT'&&<section className="account-callout account-mode-notice" aria-label="Administrator review information"><div><h3 className="font-semibold">Administrator Review</h3><p className="mt-1">Status: Pending Administrator Review. An approved request creates an internal ledger credit only. Aurevia does not receive or verify external funds.</p></div></section>}
					{confirming&&(selectedMethod||manualRealFunding)&&<div className="account-confirm-panel" role="alert"><h3>{translate('confirmRequest',{type:type.toLowerCase()})}</h3><p>{money(Number(amount||0),'USD')} in the REAL account. This is an internal ledger request only. No external payment or transfer will occur; an administrator must approve the request before your available balance changes.</p><div className="mt-3 flex flex-wrap gap-2"><button type="button" className="btn bg-gold text-black" disabled={submitting} onClick={()=>void confirmSubmit()}>{submitting?translate('submitRequestStatus'):translate('confirmRequestButton')}</button><button type="button" className="btn bg-white/5" onClick={()=>setConfirming(false)}>{translate('cancelRequestButton')}</button></div></div>}
					{!confirming&&<button className="btn w-full bg-gold text-black" type="submit" disabled={loading||!hasWalletData||(type==='DEPOSIT'&&(!profile?.depositEnabled||!!profileLoadError||!realKycApproved))||(type==='WITHDRAWAL'&&(realWithdrawalBlocked||!profile?.withdrawalEnabled||profile.accountRestricted||availableBalance===null||availableBalance<=0))}>{type==='DEPOSIT'?'Submit internal credit request':'Submit internal withdrawal request'}</button>}
				</form>
				</>}
			</section>
			<section className="account-panel card p-5"><div className="account-panel-title"><div><h2>{translate('transactionHistory')}</h2><p className="account-panel-subtitle">{translate('transactionHistorySubtitle')}</p></div><div className="flex items-center gap-2"><Link className="text-link" href="/wallet/transactions">{translate('fullHistory')}</Link><button type="button" className="icon-action" aria-label={translate('refreshWalletHistory')} onClick={()=>void load(true)}><RefreshCw size={15}/></button></div></div>
				{loading?<div className="account-empty" role="status">{translate('loadingWallet')}</div>:!hasWalletData?<div className="account-empty transaction-history-error" role="status">Transaction history is unavailable until wallet data can be loaded.</div>:data.transactions.length?<div className="account-table-wrap"><table className="account-table"><thead><tr><th>{translate('request')}</th><th>{translate('amount')}</th><th>{translate('status')}</th><th>{translate('receipt')}</th></tr></thead><tbody>{data.transactions.map(transaction=><tr key={transaction.id}><td><Link className="transaction-kind" href={`/wallet/transactions/${encodeURIComponent(transaction.id)}`}>{transaction.type==='DEPOSIT'?<ArrowDownLeft size={13}/>:<ArrowUpRight size={13}/>} {transaction.type}<small className="transaction-method">{formatFundingMethodLabel(transaction.method)}</small><small className="transaction-method">{transaction.id}</small></Link></td><td>{money(Number(transaction.amount),transaction.currency)}</td><td><span className="status-pill">{statuses[transaction.status]||transaction.status}</span></td><td>{data.accountMode==='DEMO'?'Deposits and withdrawals are available in REAL Mode only.':transaction.type==='DEPOSIT'&&reserves.includes(transaction.status)?<div className="grid min-w-40 gap-1"><input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" aria-label={translate('chooseReceipt',{id:transaction.id})} onChange={event=>setReceiptFiles(current=>({...current,[transaction.id]:event.target.files?.[0]}))}/><button type="button" className="btn min-h-11 bg-white/5" disabled={!receiptFiles[transaction.id]||receiptBusy===transaction.id} onClick={()=>void uploadReceipt(transaction)}>{receiptBusy===transaction.id?translate('uploading'):translate('uploadReceipt')}</button>{transaction.hasReceipt&&<button type="button" className="text-link" onClick={()=>void openReceipt(transaction.id)}>{translate('viewPrivateReceipt')}</button>}</div>:transaction.hasReceipt?<button type="button" className="text-link" onClick={()=>void openReceipt(transaction.id)}>{translate('viewPrivateReceipt')}</button>:'Not available'}</td></tr>)}</tbody></table></div>:<div className="account-empty" role="status">No funding transactions have been submitted yet.</div>}
			</section>
		</div>
	</main></>;
}

'use client';

import {FormEvent,useCallback,useEffect,useState} from 'react';
import {RefreshCw,Search,Trash2} from 'lucide-react';
import {SUPPORTED_CURRENCIES} from '@/lib/config/simulation';
import ReceiptGenerator,{type ReceiptData} from '@/components/ReceiptGenerator';

type AdminUser={id:string;email:string;name:string|null;phone:string|null;country:string|null;role:'USER'|'ADMIN';status:string;accountMode:'DEMO'|'REAL';kycStatus:string;createdAt:string;depositEnabled:boolean;withdrawalEnabled:boolean;accountRestricted:boolean;restrictionReason:string|null};
type Adjustment={accountMode:'DEMO'|'REAL';currency:(typeof SUPPORTED_CURRENCIES)[number];amount:string;direction:'CREDIT'|'DEBIT';category:'ADMIN_ALLOCATION'|'CORRECTION'|'PROMOTIONAL'|'REVERSAL';reason:string;idempotencyKey:string};
const emptyAdjustment=(accountMode:'DEMO'|'REAL'):Adjustment=>({accountMode,currency:'USD',amount:'',direction:'CREDIT',category:'ADMIN_ALLOCATION',reason:'',idempotencyKey:''});

export default function AdminUsersPanel(){
	const [users,setUsers]=useState<AdminUser[]>([]);
	const [search,setSearch]=useState('');
	const [showDeleted,setShowDeleted]=useState(false);
	const [selected,setSelected]=useState<AdminUser|null>(null);
	const [confirmation,setConfirmation]=useState('');
	const [reason,setReason]=useState('');
	const [loading,setLoading]=useState(true);
	const [busy,setBusy]=useState(false);
	const [busyUserId,setBusyUserId]=useState('');
	const [error,setError]=useState('');
	const [notice,setNotice]=useState('');
	const [expandedUserId,setExpandedUserId]=useState('');
	const [restrictionReasons,setRestrictionReasons]=useState<Record<string,string>>({});
	const [adjustments,setAdjustments]=useState<Record<string,Adjustment>>({});
	const [adjustmentReceipt,setAdjustmentReceipt]=useState<{userId:string;receipt:ReceiptData}|null>(null);

	const load=useCallback(async(query:string,includeDeleted:boolean,signal?:AbortSignal)=>{
		try{
			const params=new URLSearchParams();
			if(query)params.set('search',query);
			if(includeDeleted)params.set('showDeleted','true');
			const queryString=params.toString();
			const response=await fetch(`/api/admin/users${queryString?`?${queryString}`:''}`,{cache:'no-store',signal});
			const result=await response.json();
			if(!response.ok)throw new Error(result.error||'Unable to load user accounts.');
			setUsers(result);setError('');
		}catch(exception){if(!(exception instanceof DOMException&&exception.name==='AbortError'))setError(exception instanceof Error?exception.message:'Unable to load user accounts.')}
		finally{setLoading(false)}
	},[]);

	function mergeUser(updated:Partial<AdminUser>&Pick<AdminUser,'id'>){
		setUsers(current=>current.map(user=>user.id===updated.id?{...user,...updated}:user));
	}

	useEffect(()=>{
		const controller=new AbortController();
		const timer=window.setTimeout(()=>void load(search.trim(),showDeleted,controller.signal),200);
		return()=>{window.clearTimeout(timer);controller.abort()};
	},[load,search,showDeleted]);

	async function deleteAccount(event:FormEvent<HTMLFormElement>){
		event.preventDefault();
		if(!selected||busy)return;
		setBusy(true);setError('');setNotice('');
		try{
			const response=await fetch('/api/admin/users/delete',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({userId:selected.id,confirmation,reason})});
			const result=await response.json();
			if(!response.ok)throw new Error(result.error||'Account deletion could not be completed.');
			setNotice(`Account ${selected.id} was anonymized and closed.`);setSelected(null);setConfirmation('');setReason('');await load(search.trim(),showDeleted);
		}catch(exception){setError(exception instanceof Error?exception.message:'Account deletion could not be completed.')}
		finally{setBusy(false)}
	}

	async function updateDeletedStatus(user:AdminUser,status:'ACTIVE'|'DELETED'){
		if(busy)return;
		setBusy(true);setBusyUserId(user.id);setError('');setNotice('');
		try{
			const response=await fetch('/api/admin/users',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({userId:user.id,status})});
			const result=await response.json();
			if(!response.ok)throw new Error(result.error||'Unable to update account status.');
			setNotice(status==='DELETED'?`Account ${user.email} moved to Deleted Items.`:`Account ${user.email} restored.`);
			await load(search.trim(),showDeleted);
		}catch(exception){setError(exception instanceof Error?exception.message:'Unable to update account status.')}
		finally{setBusy(false);setBusyUserId('')}
	}

	async function toggleStatus(user:AdminUser){
		if(busy)return;
		setBusy(true);setBusyUserId(user.id);setError('');setNotice('');
		try{
			const status=user.status==='ACTIVE'?'FROZEN':'ACTIVE';
			const response=await fetch('/api/admin/users',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({userId:user.id,status})});
			const result=await response.json();if(!response.ok)throw new Error(result.error||'Unable to update account status.');
			mergeUser(result);setNotice(`Account status updated to ${status.toLowerCase()}.`);
		}catch(exception){setError(exception instanceof Error?exception.message:'Unable to update account status.')}
		finally{setBusy(false);setBusyUserId('')}
	}

	async function updateAccountControl(user:AdminUser,field:'depositEnabled'|'withdrawalEnabled'|'accountRestricted',value:boolean){
		if(busy)return;
		const restrictionReason=restrictionReasons[user.id]?.trim()||'';
		if(field==='accountRestricted'&&value&&restrictionReason.length<3){setError('Enter a restriction reason of at least three characters before restricting the account.');return;}
		setBusy(true);setBusyUserId(user.id);setError('');setNotice('');
		try{
			const response=await fetch('/api/admin/users',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({userId:user.id,[field]:value,...(field==='accountRestricted'&&value?{restrictionReason}: {})})});
			const result=await response.json();if(!response.ok)throw new Error(result.error||'Unable to update account controls.');
			mergeUser(result);
			if(field==='accountRestricted'&&!value)setRestrictionReasons(current=>({...current,[user.id]:''}));
			setNotice(`Account controls updated for ${user.email}.`);
		}catch(exception){setError(exception instanceof Error?exception.message:'Unable to update account controls.')}
		finally{setBusy(false);setBusyUserId('')}
	}

	async function adjustBalance(event:FormEvent<HTMLFormElement>,user:AdminUser){
		event.preventDefault();
		if(busy)return;
		const adjustment=adjustments[user.id]||emptyAdjustment(user.accountMode);
		const amount=Number(adjustment.amount);
		if(!Number.isFinite(amount)||amount<=0||adjustment.reason.trim().length<3){setError('Enter a positive amount and a reason of at least three characters.');return;}
		const idempotencyKey=adjustment.idempotencyKey||crypto.randomUUID();
		const submitted={...adjustment,idempotencyKey};
		setAdjustments(current=>({...current,[user.id]:submitted}));
		setAdjustmentReceipt(null);
		setBusy(true);setBusyUserId(user.id);setError('');setNotice('');
		try{
			const response=await fetch('/api/admin/balances',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({userId:user.id,accountMode:adjustment.accountMode,currency:adjustment.currency,amount:adjustment.amount,direction:adjustment.direction,category:adjustment.category,reason:adjustment.reason.trim(),idempotencyKey})});
			const result=await response.json();if(!response.ok)throw new Error(result.error||'Unable to record the simulated ledger adjustment.');
			setNotice(`${result.replayed?'Previously recorded':'Recorded'} ${adjustment.direction.toLowerCase()} of ${Number(adjustment.amount).toFixed(2)} ${adjustment.currency} in ${adjustment.accountMode} for ${user.email}. Reference: ${result.reference}`);
			setAdjustmentReceipt({userId:user.id,receipt:{
				id:result.transactionId,
				reference:result.reference,
				status:'COMPLETED',
				type:adjustment.direction,
				accountMode:adjustment.accountMode,
				simulated:true,
				createdAt:result.createdAt,
				name:user.name||user.email,
				email:user.email,
				amount:adjustment.amount,
				currency:adjustment.currency,
				method:'Administrator direct paper-ledger adjustment',
				purpose:`${adjustment.category.replaceAll('_',' ')} · ${adjustment.reason.trim()}`,
			}});
			setAdjustments(current=>({...current,[user.id]:emptyAdjustment(adjustment.accountMode)}));
		}catch(exception){setError(exception instanceof Error?exception.message:'Unable to record the simulated ledger adjustment. Retry without changing the request.')}
		finally{setBusy(false);setBusyUserId('')}
	}

	function updateAdjustment(userId:string,defaultMode:'DEMO'|'REAL',field:keyof Adjustment,value:string){
		setAdjustments(current=>{
			const existing=current[userId]||emptyAdjustment(defaultMode);
			return {...current,[userId]:{...existing,[field]:value,idempotencyKey:''}};
		});
	}

	return <div className="account-page admin-users-page">
		<header className="account-heading"><div><span className="account-kicker">WORKSPACE · ACCOUNTS</span><h1>User accounts</h1><p>Manage customer access and review deleted accounts. Admin identities are managed separately.</p></div><button className="icon-action" type="button" aria-label="Refresh user accounts" onClick={()=>void load(search.trim(),showDeleted)}><RefreshCw size={15}/></button></header>
		{error&&<div className="account-callout mb-3" role="alert">{error}</div>}{notice&&<p className="mb-3 text-sm text-profit" role="status">{notice}</p>}
		<label className="account-label mb-4 block">Search users by name, email, or account ID<div className="relative mt-1"><Search size={15} className="absolute left-3 top-3.5 muted"/><input className="input pl-9" value={search} onChange={event=>setSearch(event.target.value)} maxLength={120} autoComplete="off" placeholder="Search accounts"/></div></label>
		<label className="mb-4 inline-flex min-h-11 cursor-pointer items-center gap-2 text-sm"><input type="checkbox" checked={showDeleted} onChange={event=>setShowDeleted(event.target.checked)}/>Show deleted accounts</label>
		<div className="overflow-hidden rounded-md border border-white/10">
			{loading?<p className="account-empty" role="status">Loading accounts…</p>:users.length?<div className="divide-y divide-white/10">{users.map(user=><article className="p-4" key={user.id}>
				<div className="flex flex-wrap items-center justify-between gap-3"><div className="min-w-0"><b className="block break-words">{user.name||'Unnamed account'} · {user.email}</b><small className="muted break-all">{user.id} · {user.role} · {user.accountMode} · {user.kycStatus} · {user.status}</small></div><div className="flex flex-wrap gap-2">
					{user.status==='DELETED'?<><button type="button" className="btn min-h-10 bg-profit text-black" disabled={busy} onClick={()=>void updateDeletedStatus(user,'ACTIVE')}>{busyUserId===user.id?'Saving…':'Restore'}</button><button type="button" className="btn min-h-10 bg-loss text-black" disabled={busy} onClick={()=>{setSelected(user);setConfirmation('');setReason('')}}><Trash2 size={14}/>Permanently delete</button></>:<><button type="button" className="btn min-h-10 bg-white/5" disabled={busy||user.status==='CLOSED'} onClick={()=>void toggleStatus(user)}>{busyUserId===user.id?'Saving…':user.status==='ACTIVE'?'Freeze':'Unfreeze'}</button><button type="button" className="btn min-h-10 bg-loss text-black" disabled={busy||user.status==='CLOSED'} onClick={()=>void updateDeletedStatus(user,'DELETED')}><Trash2 size={14}/>Delete</button><button type="button" className="btn min-h-10 border border-loss/40 bg-loss/10 text-loss" disabled={busy||user.status==='CLOSED'} onClick={()=>{setSelected(user);setConfirmation('');setReason('')}}>Permanently delete</button></>}
				</div></div>
				{user.status==='DELETED'?<p className="mt-3 text-sm muted">This account cannot sign in. Restore it to re-enable account access.</p>:<details className="mt-2" open={expandedUserId===user.id} onToggle={event=>{if(event.currentTarget.open)setExpandedUserId(user.id);else if(expandedUserId===user.id)setExpandedUserId('')}}><summary className="min-h-11 cursor-pointer py-2 text-sm gold">Account controls, verification, and ledger</summary>{expandedUserId===user.id&&<div>
					<dl className="mt-2 grid gap-2 text-xs sm:grid-cols-2"><div><dt className="muted">Country</dt><dd>{user.country||'Not set'}</dd></div><div><dt className="muted">Phone</dt><dd>{user.phone||'Not set'}</dd></div><div><dt className="muted">Created</dt><dd>{new Date(user.createdAt).toLocaleString()}</dd></div><div><dt className="muted">Deposit / withdrawal</dt><dd>{user.depositEnabled?'Enabled':'Disabled'} / {user.withdrawalEnabled?'Enabled':'Disabled'}</dd></div><div><dt className="muted">Account restriction</dt><dd>{user.accountRestricted?user.restrictionReason||'Restricted':'None'}</dd></div></dl>
					<div className="mt-4 flex flex-wrap gap-2">
						<button className="btn min-h-10 bg-white/5" type="button" disabled={busy||user.status==='CLOSED'} onClick={()=>void updateAccountControl(user,'depositEnabled',!user.depositEnabled)}>{user.depositEnabled?'Disable deposits':'Enable deposits'}</button>
						<button className="btn min-h-10 bg-white/5" type="button" disabled={busy||user.status==='CLOSED'} onClick={()=>void updateAccountControl(user,'withdrawalEnabled',!user.withdrawalEnabled)}>{user.withdrawalEnabled?'Disable withdrawals':'Enable withdrawals'}</button>
						<a className="btn min-h-10 bg-white/5" href="/admin/kyc">Open verification review</a>
						<a className="btn min-h-10 bg-white/5" href="/admin/tiers">Open tier reviews</a>
					</div>
					<div className="mt-4 grid gap-3 border-t border-white/10 pt-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
						<label className="account-label">Restriction reason<input className="input mt-1" maxLength={500} value={restrictionReasons[user.id]??user.restrictionReason??''} onChange={event=>setRestrictionReasons(current=>({...current,[user.id]:event.target.value}))}/></label>
						<button className="btn min-h-11 bg-loss text-black" type="button" disabled={busy||user.status==='CLOSED'} onClick={()=>void updateAccountControl(user,'accountRestricted',!user.accountRestricted)}>{user.accountRestricted?'Remove account restriction':'Restrict account'}</button>
					</div>
					<form className="mt-4 grid gap-3 border-t border-white/10 pt-4 sm:grid-cols-2 lg:grid-cols-4" onSubmit={event=>void adjustBalance(event,user)}>
						<p className="text-sm font-semibold sm:col-span-2 lg:col-span-4">Fund User Account · mode-specific simulated ledger</p>
						<label className="account-label">Account<select className="input mt-1" value={(adjustments[user.id]||emptyAdjustment(user.accountMode)).accountMode} onChange={event=>updateAdjustment(user.id,user.accountMode,'accountMode',event.target.value)}><option value="DEMO">DEMO</option><option value="REAL">REAL · simulated ledger</option></select></label>
						<label className="account-label">Direction<select className="input mt-1" value={(adjustments[user.id]||emptyAdjustment(user.accountMode)).direction} onChange={event=>updateAdjustment(user.id,user.accountMode,'direction',event.target.value)}><option value="CREDIT">Credit</option><option value="DEBIT">Debit</option></select></label>
						<label className="account-label">Category<select className="input mt-1" value={(adjustments[user.id]||emptyAdjustment(user.accountMode)).category} onChange={event=>updateAdjustment(user.id,user.accountMode,'category',event.target.value)}><option value="ADMIN_ALLOCATION">Admin allocation</option><option value="CORRECTION">Correction</option><option value="PROMOTIONAL">Promotional</option><option value="REVERSAL">Reversal</option></select></label>
						<label className="account-label">Currency<select className="input mt-1" value={(adjustments[user.id]||emptyAdjustment(user.accountMode)).currency} onChange={event=>updateAdjustment(user.id,user.accountMode,'currency',event.target.value)}>{SUPPORTED_CURRENCIES.map(currency=><option key={currency}>{currency}</option>)}</select></label>
						<label className="account-label">Amount<input className="input mt-1" type="number" min="0.01" step="0.01" required value={(adjustments[user.id]||emptyAdjustment(user.accountMode)).amount} onChange={event=>updateAdjustment(user.id,user.accountMode,'amount',event.target.value)}/></label>
						<label className="account-label sm:col-span-2">Reason<input className="input mt-1" minLength={3} maxLength={300} required value={(adjustments[user.id]||emptyAdjustment(user.accountMode)).reason} onChange={event=>updateAdjustment(user.id,user.accountMode,'reason',event.target.value)}/></label>
						<button className="btn min-h-11 bg-gold text-black" type="submit" disabled={busy||user.role!=='USER'||user.status!=='ACTIVE'} title={user.role!=='USER'||user.status!=='ACTIVE'?'Only active customer accounts can receive ledger adjustments.':'Record an audited simulated ledger adjustment.'}>{busyUserId===user.id?'Recording…':'Record ledger adjustment'}</button>
						<p className="sm:col-span-2 lg:col-span-4 text-xs muted">Balance changes are simulated ledger entries, audited with a reason and request key. REAL-mode entries do not move external funds.</p>
					</form>
					{adjustmentReceipt?.userId===user.id&&<section className="mt-4 border-t border-white/10 pt-4"><div className="account-panel-title"><div><h3>Direct funding receipt</h3><p className="account-panel-subtitle">Printable record of the mode-specific ledger entry.</p></div></div><ReceiptGenerator receipt={adjustmentReceipt.receipt}/></section>}
				</div>}</details>}
			</article>)}</div>:<p className="account-empty">No accounts match this search.</p>}
		</div>
		{selected&&<section className="account-panel mt-4 border border-loss/30 p-5" aria-labelledby="confirm-delete-heading"><h2 id="confirm-delete-heading" className="font-semibold">Confirm permanent deletion</h2><p className="mt-2 text-sm muted">This permanently anonymizes personal data and revokes access while preserving financial and audit history. Target: {selected.name||selected.email} ({selected.id}).</p>
			<form className="mt-4 grid max-w-2xl gap-3" onSubmit={event=>void deleteAccount(event)}>
				<label className="account-label">Reason for audit history<input className="input" required minLength={3} maxLength={500} value={reason} onChange={event=>setReason(event.target.value)}/></label>
				<label className="account-label">Type DELETE to confirm<input className="input" required autoComplete="off" value={confirmation} onChange={event=>setConfirmation(event.target.value)}/></label>
				<div className="flex flex-wrap gap-2"><button className="btn bg-loss text-black" type="submit" disabled={busy||confirmation!=='DELETE'||reason.trim().length<3} aria-busy={busy}>{busy?'Deleting…':'Confirm permanent deletion'}</button><button className="btn bg-white/5" type="button" disabled={busy} onClick={()=>setSelected(null)}>Cancel</button></div>
			</form>
		</section>}
	</div>;
}
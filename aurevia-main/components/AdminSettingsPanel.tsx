'use client';

import {FormEvent,useEffect,useState} from 'react';
import {RefreshCw,Save} from 'lucide-react';
import {SIMULATED_BTC_ADDRESS_SETTING} from '@/lib/config/simulated-bitcoin-address';
import {tierBoostSettingKeys} from '@/lib/tier-boost-settings';

type Setting={key:string;value:string;updatedAt:string};

export default function AdminSettingsPanel(){
	const [settings,setSettings]=useState<Setting[]>([]);
	const [newKey,setNewKey]=useState('');
	const [newValue,setNewValue]=useState('');
	const [loading,setLoading]=useState(true);
	const [busyKey,setBusyKey]=useState('');
	const [error,setError]=useState('');
	const [notice,setNotice]=useState('');
	const [tier2Boost,setTier2Boost]=useState('0');
	const [tier3Boost,setTier3Boost]=useState('0');

	async function load(){
		setLoading(true);setError('');
		try{
			const response=await fetch('/api/admin/settings',{cache:'no-store'});
			const result=await response.json();
			if(!response.ok)throw new Error(result.error||'Unable to load system settings.');
			setSettings(result);
			setTier2Boost(result.find((setting:Setting)=>setting.key===tierBoostSettingKeys[2])?.value||'0');
			setTier3Boost(result.find((setting:Setting)=>setting.key===tierBoostSettingKeys[3])?.value||'0');
		}catch(exception){setError(exception instanceof Error?exception.message:'Unable to load system settings.')}
		finally{setLoading(false)}
	}

	useEffect(()=>{void load()},[]);

	async function save(key:string,value:string):Promise<boolean>{
		if(busyKey)return false;
		setBusyKey(key);setError('');setNotice('');
		try{
			const response=await fetch('/api/admin/settings',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({key,value})});
			const result=await response.json();
			if(!response.ok)throw new Error(result.error||'Unable to save this setting.');
			setSettings(current=>[...current.filter(setting=>setting.key!==key),result].sort((a,b)=>a.key.localeCompare(b.key)));
			if(key===tierBoostSettingKeys[2])setTier2Boost(value);
			if(key===tierBoostSettingKeys[3])setTier3Boost(value);
			setNotice(`${key} saved.`);
			return true;
		}catch(exception){setError(exception instanceof Error?exception.message:'Unable to save this setting.')}
		finally{setBusyKey('')}
		return false;
	}

	async function createSetting(event:FormEvent<HTMLFormElement>){
		event.preventDefault();
		const key=newKey.trim();
		if(!key||busyKey)return;
		if(await save(key,newValue)){setNewKey('');setNewValue('')}
	}

	return <div className="account-page">
		<header className="account-heading"><div><span className="account-kicker">SERVICE &amp; SYSTEM</span><h1>System settings</h1><p>Manage the system values consumed by the application.</p></div><button className="icon-action" type="button" aria-label="Refresh system settings" onClick={()=>void load()} disabled={loading}><RefreshCw size={15}/></button></header>
		<div className="account-callout mb-4"><span>The administrator-posted Bitcoin address is used for manual deposit review. Aurevia does not monitor or process Bitcoin transfers; a reviewed deposit is credited only as an audited USD ledger entry.</span></div>
		{notice&&<p className="mb-3 text-sm text-profit" role="status">{notice}</p>}{error&&<p className="mb-3 text-sm text-loss" role="alert">{error}</p>}
		<section className="account-panel card p-5"><div className="account-panel-title"><div><h2>Configured values</h2><p className="account-panel-subtitle">Saving a value records an administrator audit event.</p></div></div>
			{loading?<p className="account-empty" role="status">Loading system settings…</p>:<>
				<div className="account-panel mt-4 p-4">
					<h3 className="font-semibold">Simulated earning boosts</h3>
					<p className="mt-1 text-sm muted">These percentage-point boosts are captured when a new investment is allocated and apply only to simulated opportunity payouts after settlement. Existing allocations are unchanged; simulated returns are not guaranteed.</p>
					<div className="mt-3 grid gap-3 sm:grid-cols-2">
						<label className="account-label">Tier 2 boost (%)<input className="input mt-1" type="number" min="0" max="1000" step="0.0001" value={tier2Boost} onChange={event=>setTier2Boost(event.target.value)}/><button className="btn mt-2 min-h-10 bg-white/5" type="button" disabled={Boolean(busyKey)||tier2Boost===(settings.find(setting=>setting.key===tierBoostSettingKeys[2])?.value||'0')} onClick={()=>void save(tierBoostSettingKeys[2],tier2Boost)}><Save size={14}/>{busyKey===tierBoostSettingKeys[2]?'Saving…':'Save Tier 2 boost'}</button></label>
						<label className="account-label">Tier 3 boost (%)<input className="input mt-1" type="number" min="0" max="1000" step="0.0001" value={tier3Boost} onChange={event=>setTier3Boost(event.target.value)}/><button className="btn mt-2 min-h-10 bg-white/5" type="button" disabled={Boolean(busyKey)||tier3Boost===(settings.find(setting=>setting.key===tierBoostSettingKeys[3])?.value||'0')} onClick={()=>void save(tierBoostSettingKeys[3],tier3Boost)}><Save size={14}/>{busyKey===tierBoostSettingKeys[3]?'Saving…':'Save Tier 3 boost'}</button></label>
					</div>
				</div>
				<div className="mt-4 space-y-4">{settings.filter(setting=>!Object.values(tierBoostSettingKeys).some(key=>key===setting.key)).map(setting=><SettingEditor key={setting.key} setting={setting} busy={busyKey===setting.key} onSave={save}/>)}</div>
			</>}
			{!loading&&!settings.some(setting=>setting.key===SIMULATED_BTC_ADDRESS_SETTING)&&<SettingEditor setting={{key:SIMULATED_BTC_ADDRESS_SETTING,value:'',updatedAt:''}} busy={busyKey===SIMULATED_BTC_ADDRESS_SETTING} onSave={save}/>}
			{!loading&&<form className="mt-5 grid gap-3 border-t border-white/10 pt-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto]" onSubmit={event=>void createSetting(event)}>
				<label className="account-label">Setting key<input className="input mt-1" required minLength={1} maxLength={100} value={newKey} onChange={event=>setNewKey(event.target.value)}/></label>
				<label className="account-label">Value<input className="input mt-1" maxLength={500} value={newValue} onChange={event=>setNewValue(event.target.value)}/></label>
				<button className="btn min-h-11 bg-gold text-black sm:self-end" type="submit" disabled={Boolean(busyKey)}><Save size={15}/>{busyKey===newKey?'Saving…':'Add setting'}</button>
			</form>}
		</section>
	</div>;
}

function SettingEditor({setting,busy,onSave}:{setting:Setting;busy:boolean;onSave:(key:string,value:string)=>Promise<boolean>}){
	const [value,setValue]=useState(setting.value);
	useEffect(()=>setValue(setting.value),[setting.value]);
	const bitcoin=setting.key===SIMULATED_BTC_ADDRESS_SETTING;
	return <form className="grid gap-3 rounded-lg border border-white/10 p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto] sm:items-end" onSubmit={event=>{event.preventDefault();void onSave(setting.key,value)}}>
		<div><label className="account-label">Setting key<input className="input mt-1" value={setting.key} readOnly/></label>{setting.updatedAt&&<small className="muted">Updated {new Date(setting.updatedAt).toLocaleString()}</small>}</div>
		<label className="account-label">{bitcoin?'Display address (optional)':'Value'}<input className="input mt-1" maxLength={500} value={value} onChange={event=>setValue(event.target.value)} placeholder={bitcoin?'No address configured':''}/></label>
		<button className="btn min-h-11 bg-white/5" type="submit" disabled={busy||value===setting.value}><Save size={15}/>{busy?'Saving…':'Save'}</button>
		{bitcoin&&<p className="sm:col-span-3 text-xs muted">Aurevia does not monitor the Bitcoin network or automatically verify incoming transfers. Admin approval requires private receipt evidence and creates a separate simulated USD ledger credit.</p>}
	</form>;
}

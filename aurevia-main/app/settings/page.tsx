'use client';

import {FormEvent,useEffect,useState} from 'react';
import {signOut,useSession} from 'next-auth/react';
import Image from 'next/image';
import {Bell,Check,KeyRound,ShieldCheck,Trash2,UserRound} from 'lucide-react';
import Nav from '@/components/Nav';
import {useLocale} from '@/lib/i18n-context';

type Profile={id:string;email:string;name:string|null;firstName:string;lastName:string;phone:string|null;phoneVerified:boolean;country:string|null;address:string|null;hasAvatar:boolean;twoFactorEnabled:boolean;role:'USER'|'ADMIN';status:string;kycStatus:string;profileLocked:boolean;profileLockAt:string|null};

export default function Settings(){
	const [profile,setProfile]=useState<Profile|null>(null);
	const [section,setSection]=useState<'profile'|'security'|'preferences'>('profile');
	const [message,setMessage]=useState('');
	const [error,setError]=useState('');
	const [loading,setLoading]=useState(true);
	const [saving,setSaving]=useState(false);
	const [avatarFile,setAvatarFile]=useState<File|null>(null);
	const [avatarUrl,setAvatarUrl]=useState('');
	const [avatarSaving,setAvatarSaving]=useState(false);
	const [showDeleteForm,setShowDeleteForm]=useState(false);
	const [deletePassword,setDeletePassword]=useState('');
	const [deleteConfirmation,setDeleteConfirmation]=useState('');
	const [deleting,setDeleting]=useState(false);
	const [retryCount,setRetryCount]=useState(0);
	const {data:session}=useSession();
	const {translate}=useLocale();

	useEffect(()=>{
		let active=true;
		fetch('/api/profile').then(async response=>{
			const result=await response.json();
			if(!response.ok)throw new Error(result.error||'Unable to load your profile.');
			if(active){
				setProfile(result);
				if(result.hasAvatar){const avatar=await fetch('/api/profile/avatar',{cache:'no-store'});if(avatar.ok){const signed=await avatar.json();if(active)setAvatarUrl(signed.url)}}
			}
		}).catch(exception=>{if(active)setError(exception instanceof Error?exception.message:'Unable to load your profile.')}).finally(()=>{if(active)setLoading(false)});
		return()=>{active=false};
	},[retryCount]);

	async function save(event:FormEvent<HTMLFormElement>){
		event.preventDefault();
		if(!profile||saving)return;
		setSaving(true);setMessage('');setError('');
		try{
			const response=await fetch('/api/profile',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({firstName:profile.firstName,lastName:profile.lastName,phone:profile.phone||'',country:profile.country||'',address:profile.address||'',twoFactorEnabled:profile.twoFactorEnabled})});
			const result=await response.json();
			if(!response.ok)throw new Error(result.error||'Unable to save profile.');
			const refreshed=await fetch('/api/profile',{cache:'no-store'});
			const freshProfile=await refreshed.json();
			if(!refreshed.ok)throw new Error(freshProfile.error||'Profile saved, but could not be reloaded.');
			setProfile(freshProfile);setMessage('Profile saved successfully.');
		}catch(exception){setError(exception instanceof Error?exception.message:'Unable to save profile.')}
		finally{setSaving(false)}
	}

	async function uploadAvatar(){
		if(!avatarFile||avatarSaving)return;
		setAvatarSaving(true);setError('');setMessage('');
		try{
			const body=new FormData();body.append('file',avatarFile);
			const response=await fetch('/api/profile/avatar',{method:'POST',body});
			const result=await response.json();if(!response.ok)throw new Error(result.error||'Profile photo upload failed.');
			const view=await fetch('/api/profile/avatar',{cache:'no-store'});if(!view.ok)throw new Error('Profile photo saved but could not be loaded.');
			const signed=await view.json();setAvatarUrl(signed.url);setAvatarFile(null);setProfile(current=>current?{...current,hasAvatar:true}:current);setMessage('Profile photo updated.');
		}catch(exception){setError(exception instanceof Error?exception.message:'Profile photo upload failed.')}
		finally{setAvatarSaving(false)}
	}

	async function deleteAccount(event:FormEvent<HTMLFormElement>){
		event.preventDefault();
		if(deleting)return;
		setDeleting(true);setError('');
		try{
			const response=await fetch('/api/account/delete',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:deletePassword,confirmation:deleteConfirmation})});
			const result=response.status===204?null:await response.json();
			if(!response.ok)throw new Error(result?.error||'Account deletion could not be completed.');
			await signOut({callbackUrl:'/register?deleted=1'});
		}catch(exception){setError(exception instanceof Error?exception.message:'Account deletion could not be completed.');setDeleting(false)}
	}

	const verification=profile?.kycStatus==='APPROVED'?'Approved':profile?.kycStatus==='REJECTED'?'Needs attention':'Pending';

	return <><Nav/><main className="account-page">
		<header className="account-heading"><div><span className="account-kicker">{translate('accountCenter')} · {session?.user?.accountMode||'ACCOUNT'}</span><h1>{translate('settingsTitle')}</h1><p>{translate('settingsSubtitle')}</p></div><div className="flex flex-wrap items-center gap-2"><span className={`status-pill ${session?.user?.accountMode==='REAL'?'mode-real':'mode-demo'}`}>{session?.user?.accountMode||'ACCOUNT'}</span><span className="status-pill">{loading?translate('loading'):profile?.status||translate('unavailable')}</span></div></header>
		{error&&<div className="account-callout mb-4" role="alert"><span>{error}</span><button type="button" className="text-link" disabled={loading} onClick={()=>{setError('');setLoading(true);setRetryCount(value=>value+1)}}>{translate('retry')}</button></div>}
		<div className="settings-layout">
			<nav className="settings-tabs" aria-label={translate('settingsSections')} role="tablist">
				<button type="button" role="tab" aria-selected={section==='profile'} className={section==='profile'?'is-active':''} onClick={()=>setSection('profile')}><UserRound size={16}/>{translate('profileLabel')}</button>
				<button type="button" role="tab" aria-selected={section==='security'} className={section==='security'?'is-active':''} onClick={()=>setSection('security')}><KeyRound size={16}/>{translate('security')}</button>
				<button type="button" role="tab" aria-selected={section==='preferences'} className={section==='preferences'?'is-active':''} onClick={()=>setSection('preferences')}><Bell size={16}/>{translate('preferences')}</button>
			</nav>
			<div className="settings-content">
				{section==='profile'&&<section className="account-panel card p-5" role="tabpanel"><div className="account-panel-title"><div><h2>{translate('personalProfile')}</h2><p className="account-panel-subtitle">{translate('profileDetailsSubtitle')}</p></div><UserRound size={18} className="gold" aria-hidden="true"/></div>
					{profile&&<form onSubmit={save} className="account-form-grid">
						{profile.profileLocked&&<div className="account-callout md:col-span-2" role="status"><ShieldCheck size={16}/><span>Verified profile details are locked as of {profile.profileLockAt?new Date(profile.profileLockAt).toLocaleDateString():''}. Contact support to request a correction.</span></div>}
						<div className="account-label md:col-span-2"><span>{translate('profilePhoto')}</span><div className="mt-2 flex flex-wrap items-center gap-3">{avatarUrl&&<Image src={avatarUrl} unoptimized alt={translate('profilePhotoAlt')} width={92} height={92} className="profile-avatar"/>}<input type="file" accept="image/png,image/jpeg,image/webp" aria-label={translate('chooseProfilePhoto')} disabled={profile.profileLocked} onChange={event=>setAvatarFile(event.target.files?.[0]||null)}/><button className="btn min-h-11 bg-white/5" type="button" disabled={profile.profileLocked||!avatarFile||avatarSaving} onClick={()=>void uploadAvatar()}>{avatarSaving?translate('uploading'):translate('uploadPhoto')}</button></div><small className="mt-1 block muted">{translate('privateImage')}</small></div>
						<label className="account-label md:col-span-2">{translate('emailAddress')}<input className="input" type="email" autoComplete="email" value={profile.email} disabled/></label>
						<label className="account-label">{translate('firstName')}<input className="input" autoComplete="given-name" required maxLength={60} value={profile.firstName} disabled={profile.profileLocked} onChange={event=>setProfile({...profile,firstName:event.target.value})}/></label>
						<label className="account-label">{translate('lastName')}<input className="input" autoComplete="family-name" maxLength={60} value={profile.lastName} disabled={profile.profileLocked} onChange={event=>setProfile({...profile,lastName:event.target.value})}/></label>
						<label className="account-label">{translate('phone')}<input className="input" type="tel" autoComplete="tel" maxLength={40} value={profile.phone||''} disabled={profile.profileLocked} onChange={event=>setProfile({...profile,phone:event.target.value})}/></label>
						<p className="muted text-xs">{translate('phoneVerification')}: {profile.phoneVerified?translate('verifiedThroughSms'):translate('notVerified')}</p>
						<label className="account-label">{translate('country')}<input className="input" autoComplete="country-name" required minLength={2} maxLength={80} value={profile.country||''} disabled={profile.profileLocked} onChange={event=>setProfile({...profile,country:event.target.value})}/></label>
						<label className="account-label md:col-span-2">{translate('addressOptional')}<input className="input" autoComplete="street-address" maxLength={500} value={profile.address||''} disabled={profile.profileLocked} onChange={event=>setProfile({...profile,address:event.target.value})}/></label>
						<div className="account-callout md:col-span-2"><ShieldCheck size={16}/><span>{translate('verificationStatus')}: <b>{verification}</b>. {translate('reviewYourDetails')} <a className="gold" href="/kyc">{translate('verificationPage')}</a>.</span></div>
						<div className="md:col-span-2"><button type="submit" className="btn bg-gold text-black" disabled={profile.profileLocked||saving||loading} aria-busy={saving}>{saving?translate('saving'):translate('saveProfile')}</button>{message&&<p className="mt-3 text-sm text-profit" role="status">{message}</p>}</div>
					</form>}
					{loading&&!profile&&<div className="account-empty" role="status">{translate('loadingProfile')}</div>}
				</section>}
				{section==='security'&&<section className="account-panel card p-5" role="tabpanel"><div className="account-panel-title"><div><h2>{translate('securityOverview')}</h2><p className="account-panel-subtitle">{translate('securitySubtitle')}</p></div><ShieldCheck size={18} className="gold" aria-hidden="true"/></div>
					<div className="security-row"><span className="security-icon"><Check size={16}/></span><div><b>{translate('passwordSignIn')}</b><p>{translate('credentialAuthentication')}</p></div><span className="status-pill">{translate('enabled')}</span></div>
					<div className="security-row"><span className="security-icon"><KeyRound size={16}/></span><div><b>{translate('twoFactorFlag')}</b><p>{translate('twoFactorSimulation')}</p></div><span className="status-pill">{profile?.twoFactorEnabled?translate('flagOn'):translate('notEnabled')}</span></div>
					<div className="security-row"><span className="security-icon"><UserRound size={16}/></span><div><b>{translate('currentServerSession')}</b><p>{translate('sessionIdCopy',{sessionId:session?.user.sessionId||translate('loading')})}</p></div><span className="status-pill">{translate('oneActiveSession')}</span></div>
					<div className="account-callout mt-4"><Bell size={16}/><span>{translate('notificationBellCopy')}</span></div>
					<section className="mt-6 border-t border-white/10 pt-5" aria-labelledby="delete-account-heading"><div className="flex items-center gap-2"><Trash2 size={17} className="text-loss"/><h3 id="delete-account-heading" className="font-semibold">Delete My Account</h3></div><p className="mt-2 max-w-2xl text-sm muted">Deleting your account closes access and removes personal profile, identity, and support data. You will lose access to account history. Anonymized ledger and audit records may remain to preserve financial integrity.</p>
						{!showDeleteForm?<button type="button" className="btn mt-4 bg-loss text-black" onClick={()=>setShowDeleteForm(true)}>Delete My Account</button>:<form className="mt-4 grid max-w-xl gap-3" onSubmit={event=>void deleteAccount(event)}>
							<label className="account-label">Current password<input className="input" type="password" autoComplete="current-password" required maxLength={128} value={deletePassword} onChange={event=>setDeletePassword(event.target.value)}/></label>
							<label className="account-label">Type DELETE to confirm<input className="input" autoComplete="off" required value={deleteConfirmation} onChange={event=>setDeleteConfirmation(event.target.value)}/></label>
							<div className="flex flex-wrap gap-2"><button type="submit" className="btn bg-loss text-black" disabled={deleting||deleteConfirmation!=='DELETE'} aria-busy={deleting}>{deleting?'Deleting account…':'Confirm account deletion'}</button><button type="button" className="btn bg-white/5" disabled={deleting} onClick={()=>{setShowDeleteForm(false);setDeletePassword('');setDeleteConfirmation('')}}>Cancel</button></div>
						</form>}
					</section>
				</section>}
				{section==='preferences'&&<section className="account-panel card p-5" role="tabpanel"><div className="account-panel-title"><div><h2>{translate('preferences')}</h2><p className="account-panel-subtitle">{translate('preferencesSubtitle')}</p></div><Bell size={18} className="gold" aria-hidden="true"/></div><div className="account-empty">{translate('notificationDelivery')}</div></section>}
			</div>
		</div>
	</main></>;
}

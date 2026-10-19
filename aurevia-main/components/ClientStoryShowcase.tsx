'use client';

import {useEffect,useState} from 'react';
import Image from 'next/image';
import Link from 'next/link';
import {ArrowUpRight,ShieldCheck} from 'lucide-react';

type ClientStory={id:string;displayName:string;country:string;cityOrRegion:string|null;quote:string;imageUrl:string|null;verifiedClientStory:true;withdrawalAmount?:string;currency?:string};

export default function ClientStoryShowcase(){
	const [stories,setStories]=useState<ClientStory[]>([]);
	const [loading,setLoading]=useState(true);
	const [error,setError]=useState('');
	useEffect(()=>{
		let active=true;
		void fetch('/api/client-stories',{cache:'no-store'}).then(async response=>{
			if(!response.ok)throw new Error('Unable to load verified client stories.');
			const result=await response.json();
			if(!Array.isArray(result))throw new Error('Verified client stories are unavailable.');
			return result as ClientStory[];
		}).then(result=>{if(active){setStories(result.slice(0,3));setError('')}}).catch(exception=>{if(active)setError(exception instanceof Error?exception.message:'Verified client stories are unavailable.')}).finally(()=>{if(active)setLoading(false)});
		return ()=>{active=false};
	},[]);
	return <section className="home-section" aria-labelledby="client-stories-heading">
		<div className="section-heading"><div><p className="eyebrow">CONSENTED CUSTOMER EXPERIENCES</p><h2 id="client-stories-heading">Investment testimonials</h2><p className="section-intro">Only published stories with verified customer records and confirmed consent are shown.</p></div><Link className="text-link" href="/client-stories">View all stories <ArrowUpRight size={14}/></Link></div>
		{loading?<p className="client-stories-empty text-sm text-slate-300" role="status">Loading consented customer stories…</p>:error?<p className="client-stories-empty text-sm text-amber-100" role="status">{error} No placeholder testimonials or performance claims are shown.</p>:stories.length?<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">{stories.map(story=><article key={story.id} className="card client-story-card min-w-0 p-5 sm:p-6">
			<div className="mb-4 flex items-center justify-between gap-3">{story.imageUrl?<Image src={story.imageUrl} alt={`Portrait for ${story.displayName}'s verified story`} width={128} height={128} unoptimized className="client-story-portrait"/>:<span className="client-story-monogram" aria-hidden="true">{story.displayName.trim().charAt(0).toUpperCase()}</span>}<span className="client-story-verified"><ShieldCheck size={14}/> Verified client story</span></div>
			<blockquote className="client-story-quote whitespace-pre-line break-words">“{story.quote}”</blockquote>
			<div className="mt-5 border-t border-white/10 pt-4"><h3 className="font-semibold">{story.displayName}</h3><p className="muted text-sm">{[story.cityOrRegion,story.country].filter(Boolean).join(', ')}</p>
				{story.withdrawalAmount&&<p className="mt-3 text-sm">Verified withdrawal · {Number(story.withdrawalAmount).toLocaleString()} {story.currency}</p>}
			</div>
		</article>)}</div>:<div className="client-stories-empty"><span className="client-story-verified"><ShieldCheck size={14}/> Consent-first publication</span><p className="mt-3 max-w-2xl text-sm leading-7 text-slate-300">No verified investment testimonials are published yet. We do not invent customer identities, quotations, headshots, verification badges or performance figures. Approved customer stories will appear here when available.</p></div>}
	</section>;
}
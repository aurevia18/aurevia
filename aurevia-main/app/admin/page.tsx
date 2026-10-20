import Link from 'next/link';
import {redirect} from 'next/navigation';
import {ArrowUpRight,BriefcaseBusiness,ClipboardCheck,FileCheck2,MessageSquareText,Radio,ReceiptText,ScrollText,Settings2,Trash2,UsersRound} from 'lucide-react';
import AdminNav from '@/components/AdminNav';
import {requireAdmin} from '@/lib/auth';

const workspaces=[
	{
		title:'Workspace',
		description:'Manage customers, investments, funding, markets, and broadcasts.',
		links:[
			{href:'/admin/users',label:'User accounts',description:'Search accounts, manage access, and close accounts.',icon:UsersRound},
			{href:'/admin/content',label:'Client stories',description:'Review client story content, evidence, and publication status.',icon:Radio},
			{href:'/admin/investments',label:'Investment operations',description:'Publish opportunities and review investment activity.',icon:BriefcaseBusiness},
			{href:'/admin/payments',label:'Funding review',description:'Approve or reject internal REAL ledger credit and withdrawal requests.',icon:ReceiptText},
			{href:'/admin/payments?type=WITHDRAWAL',label:'Withdrawals',description:'Review and approve or reject pending internal REAL ledger debits.',icon:ReceiptText},
			{href:'/admin/approved-deposits',label:'Approved deposits',description:'Search approved internal ledger credit records and administrator decisions.',icon:ReceiptText},
			{href:'/admin/approved-withdrawals',label:'Approved withdrawals',description:'Review internal ledger debits posted after administrator approval.',icon:ReceiptText},
			{href:'/admin/settlements',label:'Settlements',description:'Inspect simulated funding settlement records.',icon:ReceiptText},
			{href:'/admin/positions',label:'Open positions',description:'Review and force-close simulated customer positions.',icon:BriefcaseBusiness},
			{href:'/admin/markets',label:'Market management',description:'Configure simulated instruments and market settings.',icon:Settings2},
			{href:'/admin/settings',label:'System settings',description:'Manage audited application settings and tier controls.',icon:Settings2},
			{href:'/admin/deleted-items',label:'Deleted Items',description:'Search, restore, or permanently remove soft-deleted content.',icon:Trash2},
			{href:'/admin/broadcasts',label:'Broadcasts',description:'Publish and manage customer broadcasts.',icon:Radio},
		],
	},
	{
		title:'Account review',
		description:'Process identity and account eligibility reviews.',
		links:[
			{href:'/admin/kyc',label:'Pending verification',description:'Review submitted profiles and identity documents.',icon:ClipboardCheck},
			{href:'/admin/verified-accounts',label:'Verified accounts',description:'Find accounts with completed verification.',icon:UsersRound},
			{href:'/admin/tiers',label:'Tier reviews',description:'Review customer tier upgrade requests.',icon:FileCheck2},
		],
	},
	{
		title:'Service and system',
		description:'Monitor service operations, support, and audit activity.',
		links:[
			{href:'/admin/operations',label:'Orders and ledger',description:'Inspect simulated order execution and ledger entries.',icon:ReceiptText},
			{href:'/admin/support',label:'Support inbox',description:'Respond to customer support conversations.',icon:MessageSquareText},
			{href:'/admin/nova',label:'Nova activity',description:'Review assistant activity and escalations.',icon:MessageSquareText},
			{href:'/admin/waitlist',label:'Customer waitlist',description:'Review and manage waitlist entries.',icon:UsersRound},
			{href:'/admin/providers',label:'Provider health',description:'Check configured service and market providers.',icon:Settings2},
			{href:'/admin/receipts',label:'Receipt review',description:'Review receipt records and generated documents.',icon:ReceiptText},
			{href:'/admin/audit-logs',label:'Audit log',description:'Search administrator and financial audit events.',icon:ScrollText},
		],
	},
];

export default async function Admin(){
	try{await requireAdmin()}catch{redirect('/admin/login')}
	return <><AdminNav/><main className="account-page">
		<header className="account-heading"><div><span className="account-kicker">CONTROL CENTER</span><h1>Aurevia administration</h1><p>Choose a dedicated workspace for each administrative duty.</p></div></header>
		<div className="space-y-5">
			{workspaces.map((group,index)=><section className="account-panel p-4 sm:p-5" key={group.title} aria-labelledby={`workspace-${group.title.replaceAll(' ','-').toLowerCase()}`}>
				<header className="mb-4 flex flex-wrap items-end justify-between gap-2"><div><span className="account-kicker">WORKSPACE {String(index+1).padStart(2,'0')}</span><h2 id={`workspace-${group.title.replaceAll(' ','-').toLowerCase()}`} className="mt-1 text-lg font-bold">{group.title}</h2><p className="mt-1 text-sm muted">{group.description}</p></div><span className="text-xs muted">{group.links.length} destinations</span></header>
				<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
					{group.links.map(({href,label,description,icon:Icon})=><Link key={href} href={href} className="card group flex min-h-28 items-start gap-3 p-4 transition hover:border-amber-300/50 hover:bg-white/[.04] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300">
						<span className="rounded-lg border border-white/10 bg-white/[.04] p-2 text-amber-300"><Icon size={18} aria-hidden="true"/></span>
						<span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-2 font-semibold">{label}<ArrowUpRight size={15} className="shrink-0 opacity-60 transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5" aria-hidden="true"/></span><span className="mt-1 block text-sm muted">{description}</span></span>
					</Link>)}
				</div>
			</section>)}
		</div>
	</main></>;
}

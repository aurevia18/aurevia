import {NextResponse} from 'next/server';
import {AccountMode,FundingStatus,FundingType,NotificationType,Prisma} from '@prisma/client';
import {z,ZodError} from 'zod';
import {requireAdmin} from '@/lib/auth';
import {db} from '@/lib/db';
import {ensureSystemAccount,ensureUserLedger,postDoubleEntry,balance,roundUsdAmount} from '@/lib/ledger';
import {jsonSafe} from '@/lib/serializers';
import {createNotification} from '@/lib/notifications';
import {sendSupportEmail} from '@/lib/email';
import {validateDepositApproval} from '@/lib/production-policy';
import {getRealWithdrawableBalance} from '@/lib/real-withdrawals';

const schema=z.object({id:z.string().min(1),decision:z.enum(['APPROVED','REJECTED','REQUEST_INFO']),note:z.string().trim().max(500).optional()}).superRefine((value,context)=>{
	if(value.decision==='REQUEST_INFO'&&(!value.note||value.note.trim().length<3))context.addIssue({code:z.ZodIssueCode.custom,path:['note'],message:'An administrator review note of at least 3 characters is required.'});
});
const pendingStatuses:FundingStatus[]=[FundingStatus.PENDING,FundingStatus.PENDING_REVIEW];

export async function GET(req:Request){
	try{
		await requireAdmin();
		const includeHistory=new URL(req.url).searchParams.get('history')==='true';
		const settlementQueue=new URL(req.url).searchParams.get('settlement')==='true';
		const simulatedLifecycle=new URL(req.url).searchParams.get('lifecycle')==='true';
		const requestedType=new URL(req.url).searchParams.get('type');
		const where:Prisma.FundingRequestWhereInput=settlementQueue
			?{type:FundingType.WITHDRAWAL,status:FundingStatus.APPROVED,settlementReference:null}
			:simulatedLifecycle
				?{type:FundingType.WITHDRAWAL,accountMode:AccountMode.DEMO,status:{in:[FundingStatus.APPROVED,FundingStatus.PROCESSING]}}
				:includeHistory?{}:{status:{in:pendingStatuses}};
		if(!settlementQueue&&!simulatedLifecycle&&(requestedType==='DEPOSIT'||requestedType==='WITHDRAWAL'))where.type=requestedType;
		const requests=await db.fundingRequest.findMany({where,include:{user:{select:{email:true,name:true}},paymentMethod:{select:{name:true}}},orderBy:{createdAt:includeHistory?'desc':'asc'},take:includeHistory?200:undefined});
		const approvals=includeHistory?await db.auditLog.findMany({where:{entity:'FUNDING',entityId:{in:requests.map(request=>request.id)},action:{in:['FUNDING_APPROVED','BTC_DEPOSIT_APPROVED']}},select:{entityId:true,createdAt:true,actor:{select:{name:true,email:true}}},orderBy:{createdAt:'desc'}}):[];
		const approvalByRequest=new Map(approvals.map(approval=>[approval.entityId,{reviewedAt:approval.createdAt,reviewedBy:approval.actor}]));
		const safeRequests=requests.map(({receiptKey,...request})=>({...request,hasReceipt:!!receiptKey,...(approvalByRequest.has(request.id)?approvalByRequest.get(request.id):{})}));
		return NextResponse.json(jsonSafe(safeRequests),{headers:{'Cache-Control':'private, no-store'}});
	}catch(error){
		const status=error instanceof Error&&error.message==='UNAUTHORIZED'?401:403;
		return NextResponse.json({error:status===401?'Unauthorized':'Forbidden'},{status});
	}
}

export async function PATCH(req:Request){
	try{
		const admin=await requireAdmin();
		const input=schema.parse(await req.json());
		const request=await db.$transaction(async tx=>{
			const current=await tx.fundingRequest.findUnique({where:{id:input.id}});
			if(!current||!pendingStatuses.includes(current.status))throw new Error('FUNDING_NOT_PENDING');
			if(admin.id===current.userId)throw new Error('FUNDING_SELF_REVIEW_FORBIDDEN');
			if(current.accountMode===AccountMode.DEMO&&input.decision!=='REJECTED')throw new Error('DEMO_FUNDING_DISABLED');
			if(current.currency!=='USD'&&input.decision==='APPROVED')throw new Error('INTERNAL_USD_FUNDING_REQUIRED');
			if(input.decision==='REQUEST_INFO'){
				const changed=await tx.fundingRequest.updateMany({where:{id:current.id,status:{in:pendingStatuses}},data:{status:FundingStatus.PENDING,adminNote:input.note,reviewedAt:new Date()}});
				if(changed.count!==1)throw new Error('FUNDING_ALREADY_REVIEWED');
				const updated=await tx.fundingRequest.findUniqueOrThrow({where:{id:current.id}});
				await tx.auditLog.create({data:{actorId:admin.id,action:'FUNDING_INFO_REQUESTED',entity:'FUNDING',entityId:updated.id,metadata:{type:updated.type,accountMode:updated.accountMode,reason:input.note,externalEvidenceUserSubmitted:!!updated.receiptKey||!!updated.transactionReference}}});
				await createNotification(tx,{userId:updated.userId,type:updated.type===FundingType.DEPOSIT?NotificationType.DEPOSIT:NotificationType.WITHDRAWAL,title:'More information requested',message:`An administrator needs more information about your internal REAL ${updated.type.toLowerCase()} request. ${input.note} No external payment is processed through Aurevia.`,dedupeKey:`funding:${updated.id}:info:${updated.updatedAt.toISOString()}`,relatedEntity:'FUNDING',relatedId:updated.id,actionUrl:`/wallet/transactions/${updated.id}`});
				return updated;
			}
			const creditCurrency='USD';
			if(current.type===FundingType.DEPOSIT&&input.decision==='APPROVED')validateDepositApproval(current.amount.toString(),current.amount.toString());
			const fundingUser=await tx.user.findUnique({where:{id:current.userId},select:{withdrawalEnabled:true,accountRestricted:true}});
			if(current.type===FundingType.WITHDRAWAL&&(!fundingUser?.withdrawalEnabled||fundingUser.accountRestricted))throw new Error('WITHDRAWAL_RESTRICTED');
			const approvedCredit=current.type===FundingType.DEPOSIT&&input.decision==='APPROVED'?roundUsdAmount(current.amount):null;
			const reviewedAt=new Date();
			const completesWithdrawal=input.decision==='APPROVED'&&current.type===FundingType.WITHDRAWAL;
			const settlementReference=completesWithdrawal?`INTERNAL-WITHDRAWAL:${current.id}`:null;
			const finalStatus=input.decision==='REJECTED'?FundingStatus.REJECTED:completesWithdrawal?FundingStatus.COMPLETED:FundingStatus.APPROVED;
			const changed=await tx.fundingRequest.updateMany({where:{id:current.id,status:{in:pendingStatuses}},data:{status:finalStatus,adminNote:input.note||null,reviewedAt,creditedAmount:approvedCredit,creditedCurrency:approvedCredit?creditCurrency:null,settledAt:completesWithdrawal?reviewedAt:null,settlementReference}});
			if(changed.count!==1)throw new Error('FUNDING_ALREADY_REVIEWED');
			let previousBalance:Prisma.Decimal|null=null;
			let resultingBalance:Prisma.Decimal|null=null;
			let ledgerTransactionReference:string|null=null;
			if(input.decision==='APPROVED'){
				const ledgerCurrency='USD';
				const account=await ensureUserLedger(tx,current.userId,AccountMode.REAL,ledgerCurrency);
				previousBalance=await balance(tx,account.id);
				const system=await ensureSystemAccount(tx,`SYSTEM:INTERNAL_${current.type}:REAL:USD`,`Internal Aurevia ${current.type.toLowerCase()} clearing`,ledgerCurrency,AccountMode.REAL);
				ledgerTransactionReference=`FUNDING:${current.id}:APPROVED`;
				if(current.type===FundingType.DEPOSIT){
					await postDoubleEntry(tx,{reference:ledgerTransactionReference,description:'Administrator-approved internal REAL account credit',debitAccountId:system.id,creditAccountId:account.id,amount:approvedCredit!});
				}else{
					const withdrawable=await getRealWithdrawableBalance(tx,current.userId,previousBalance,current.id);
					if(withdrawable.lt(current.amount))throw new Error('INSUFFICIENT_WITHDRAWABLE_FUNDS');
					await postDoubleEntry(tx,{reference:ledgerTransactionReference,description:'Administrator-approved internal REAL account withdrawal',debitAccountId:account.id,creditAccountId:system.id,amount:current.amount});
				}
				resultingBalance=await balance(tx,account.id);
			}
			const updated=await tx.fundingRequest.findUniqueOrThrow({where:{id:current.id}});
			await tx.auditLog.create({data:{actorId:admin.id,action:`FUNDING_${input.decision}`,entity:'FUNDING',entityId:updated.id,metadata:{userId:updated.userId,type:updated.type,accountMode:updated.accountMode,currency:updated.currency,amount:updated.amount.toString(),status:updated.status,creditedAmount:updated.creditedAmount?.toString()??null,creditedCurrency:updated.creditedCurrency,userSubmittedReference:updated.transactionReference,ledgerTransactionReference,settlementReference:updated.settlementReference,internalLedgerOnly:true,externalEvidenceUserSubmitted:!!updated.receiptKey||!!updated.transactionReference,previousBalance:previousBalance?.toString()??null,resultingBalance:resultingBalance?.toString()??null}}});
			const notificationType=updated.type===FundingType.DEPOSIT?NotificationType.DEPOSIT:NotificationType.WITHDRAWAL;
			const approved=input.decision==='APPROVED';
			const message=approved
				?updated.type==='DEPOSIT'
					?`${updated.amount.toFixed(2)} USD was credited to your REAL available balance as an internal Aurevia ledger entry. No external payment was processed.`
					:`${updated.amount.toFixed(2)} USD was debited from your REAL available balance as an internal Aurevia ledger entry. No external transfer was initiated.`
				:`Your REAL ${updated.type.toLowerCase()} request was rejected. No ledger balance was changed.${input.note?` Administrator note: ${input.note}`:''}`;
			await createNotification(tx,{userId:updated.userId,type:notificationType,title:`REAL ${updated.type.toLowerCase()} ${approved?'approved':'rejected'}`,message,dedupeKey:`funding:${updated.id}:${input.decision.toLowerCase()}`,relatedEntity:'FUNDING',relatedId:updated.id,actionUrl:`/wallet/transactions/${updated.id}`});
			return updated;
		},{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,maxWait:5_000,timeout:15_000});
		const user=await db.user.findUnique({where:{id:request.userId},select:{email:true}});
		const delivery=user?await sendSupportEmail(`Internal funding request ${input.decision.toLowerCase()}`,[`Request: ${request.id}`,`User: ${request.userId}`,`Type: ${request.type}`,`Mode: ${request.accountMode}`,`Amount: ${request.amount.toString()} ${request.currency}`,`Status: ${request.status}`,`Reference: ${request.settlementReference|| (request.status===FundingStatus.REJECTED?request.id:`FUNDING:${request.id}:APPROVED`)}`,`Internal ledger only; no external payment or transfer.`].join('\n')):{sent:false as const,reason:'failed' as const};
		const {receiptKey,...safeRequest}=request;
		return NextResponse.json({...jsonSafe(safeRequest),hasReceipt:!!receiptKey,emailDelivery:delivery.sent?'sent':delivery.reason||'failed'},{headers:{'Cache-Control':'private, no-store'}});
	}catch(error){
		if(error instanceof ZodError)return NextResponse.json({error:'Invalid review details.'},{status:400});
		if(error instanceof Error&&error.message==='UNAUTHORIZED')return NextResponse.json({error:'Unauthorized'},{status:401});
		if(error instanceof Error&&error.message==='FORBIDDEN')return NextResponse.json({error:'Forbidden'},{status:403});
		if(error instanceof Error&&error.message==='FUNDING_SELF_REVIEW_FORBIDDEN')return NextResponse.json({error:'Administrators cannot review their own funding requests.'},{status:403});
		if(error instanceof Error&&error.message==='DEMO_FUNDING_DISABLED')return NextResponse.json({error:'Deposits and withdrawals are available in REAL Mode only. Existing DEMO requests may only be rejected.'},{status:409});
		if(error instanceof Error&&error.message==='INTERNAL_USD_FUNDING_REQUIRED')return NextResponse.json({error:'Only internal USD funding requests can be approved. Legacy external-currency requests may be rejected but cannot be credited.'},{status:409});
		if(error instanceof Error&&['FUNDING_NOT_PENDING','FUNDING_ALREADY_REVIEWED','INSUFFICIENT_FUNDS','INSUFFICIENT_WITHDRAWABLE_FUNDS','WITHDRAWAL_RESTRICTED','DEPOSIT_AMOUNT_MISMATCH'].includes(error.message))return NextResponse.json({error:error.message.replaceAll('_',' ').toLowerCase()},{status:409});
		if(error&&typeof error==='object'&&'code'in error&&String(error.code)==='P2034')return NextResponse.json({error:'The request changed during review. Refresh the funding queue and try again.'},{status:409});
		return NextResponse.json({error:'Funding review failed.'},{status:400});
	}
}
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
import {BTC_FUNDING_METHOD,normalizeBitcoinTransactionId} from '@/lib/bitcoin-funding';
import {getRealWithdrawableBalance} from '@/lib/real-withdrawals';

const schema=z.object({id:z.string().min(1),decision:z.enum(['VERIFIED','APPROVED','REJECTED','REQUEST_INFO']),note:z.string().trim().max(500).optional(),creditedAmount:z.coerce.number().positive().max(100000000).optional()}).superRefine((value,context)=>{
	if((value.decision==='REQUEST_INFO'||value.decision==='VERIFIED')&&(!value.note||value.note.trim().length<3))context.addIssue({code:z.ZodIssueCode.custom,path:['note'],message:'An administrator review note of at least 3 characters is required.'});
	if(value.decision==='APPROVED'&&value.creditedAmount!==undefined&&(!value.note||value.note.trim().length<3))context.addIssue({code:z.ZodIssueCode.custom,path:['note'],message:'An administrator approval note of at least 3 characters is required.'});
});
const pendingStatuses:FundingStatus[]=[FundingStatus.PENDING,FundingStatus.PENDING_REVIEW];
const reservingStatuses:FundingStatus[]=[FundingStatus.PENDING,FundingStatus.PENDING_REVIEW,FundingStatus.APPROVED,FundingStatus.PROCESSING];

export async function GET(req:Request){
	try{
		await requireAdmin();
		const includeHistory=new URL(req.url).searchParams.get('history')==='true';
		const settlementQueue=new URL(req.url).searchParams.get('settlement')==='true';
		const simulatedLifecycle=new URL(req.url).searchParams.get('lifecycle')==='true';
		const where=settlementQueue?{type:FundingType.WITHDRAWAL,status:FundingStatus.APPROVED,settlementReference:null}:simulatedLifecycle?{type:FundingType.WITHDRAWAL,accountMode:AccountMode.DEMO,status:{in:[FundingStatus.APPROVED,FundingStatus.PROCESSING]}}:includeHistory?undefined:{status:{in:pendingStatuses}};
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
			const bitcoinDeposit=current.accountMode===AccountMode.REAL&&current.type===FundingType.DEPOSIT&&current.currency==='BTC'&&current.network==='BITCOIN'&&current.method===BTC_FUNDING_METHOD;
			if(current.currency==='BTC'&&!bitcoinDeposit)throw new Error('BTC_DEPOSIT_RECORD_INVALID');
			if(bitcoinDeposit&&(!current.receiptKey||(current.transactionReference&&!normalizeBitcoinTransactionId(current.transactionReference))))throw new Error('BTC_DEPOSIT_EVIDENCE_INCOMPLETE');
			if(input.decision==='VERIFIED'){
				if(!bitcoinDeposit)throw new Error('BTC_DEPOSIT_REQUIRED');
				if(current.verifiedAt)return current;
				const verifiedAt=new Date();
				const changed=await tx.fundingRequest.updateMany({where:{id:current.id,status:{in:pendingStatuses},verifiedAt:null},data:{verifiedAt,adminNote:input.note}});
				if(changed.count!==1)throw new Error('FUNDING_ALREADY_REVIEWED');
				const updated=await tx.fundingRequest.findUniqueOrThrow({where:{id:current.id}});
				await tx.auditLog.create({data:{actorId:admin.id,action:'BTC_DEPOSIT_MANUALLY_VERIFIED',entity:'FUNDING',entityId:updated.id,metadata:{accountMode:AccountMode.REAL,network:'BITCOIN',transactionReference:updated.transactionReference,btcAmount:updated.amount.toString(),evidenceAttached:true,manualVerification:true,credited:false,reason:input.note}}});
				await createNotification(tx,{userId:updated.userId,type:NotificationType.DEPOSIT,title:'BTC transaction manually verified',message:'An administrator marked the submitted Bitcoin transaction and receipt as manually verified. No wallet credit has been made yet; a separate approval is required.',dedupeKey:`funding:${updated.id}:btc-verified`,relatedEntity:'FUNDING',relatedId:updated.id,actionUrl:`/wallet/transactions/${updated.id}`});
				return updated;
			}
			if(input.decision==='REQUEST_INFO'){
				const changed=await tx.fundingRequest.updateMany({where:{id:current.id,status:{in:pendingStatuses}},data:{status:FundingStatus.PENDING,adminNote:input.note,reviewedAt:new Date(),...(bitcoinDeposit?{verifiedAt:null}:{})}});
				if(changed.count!==1)throw new Error('FUNDING_ALREADY_REVIEWED');
				const updated=await tx.fundingRequest.findUniqueOrThrow({where:{id:current.id}});
				await tx.auditLog.create({data:{actorId:admin.id,action:'FUNDING_INFO_REQUESTED',entity:'FUNDING',entityId:updated.id,metadata:{type:updated.type,accountMode:updated.accountMode,reason:input.note,simulated:!bitcoinDeposit,manualVerification:bitcoinDeposit}}});
				await createNotification(tx,{userId:updated.userId,type:updated.type===FundingType.DEPOSIT?NotificationType.DEPOSIT:NotificationType.WITHDRAWAL,title:'More information requested',message:`An administrator needs more information about your ${bitcoinDeposit?'REAL BTC deposit':'simulated '+updated.type.toLowerCase()} request. ${input.note}`,dedupeKey:`funding:${updated.id}:info:${updated.updatedAt.toISOString()}`,relatedEntity:'FUNDING',relatedId:updated.id,actionUrl:`/wallet/transactions/${updated.id}`});
				return updated;
			}
			if(bitcoinDeposit&&input.decision==='APPROVED'&&!current.verifiedAt)throw new Error('BTC_DEPOSIT_NOT_VERIFIED');
			if(bitcoinDeposit&&input.decision==='APPROVED'&&input.creditedAmount===undefined)throw new Error('BTC_USD_CREDIT_REQUIRED');
			const creditCurrency=bitcoinDeposit?'USD':current.currency;
			const requestedCredit=input.creditedAmount??Number(current.amount);
			const creditedDecimal=creditCurrency==='USD'?roundUsdAmount(requestedCredit):new Prisma.Decimal(requestedCredit);
			if(bitcoinDeposit&&input.decision==='APPROVED'&&creditedDecimal.lte(0))throw new Error('INVALID_ROUNDED_CREDIT');
			const creditedAmount=creditedDecimal.toNumber();
			if(current.type===FundingType.DEPOSIT&&input.decision==='APPROVED'&&!bitcoinDeposit)validateDepositApproval(current.amount.toString(),String(creditedAmount));
			if(!bitcoinDeposit&&creditedAmount>Number(current.amount))throw new Error('CREDIT_EXCEEDS_REQUEST');
			const fundingUser=await tx.user.findUnique({where:{id:current.userId},select:{withdrawalEnabled:true,accountRestricted:true}});
			if(current.type===FundingType.WITHDRAWAL&&(!fundingUser?.withdrawalEnabled||fundingUser.accountRestricted))throw new Error('WITHDRAWAL_RESTRICTED');
			const approvedCredit=current.type===FundingType.DEPOSIT&&input.decision==='APPROVED'?new Prisma.Decimal(creditedAmount):null;
			const reviewedAt=new Date();
			const completesWithdrawal=input.decision==='APPROVED'&&current.type===FundingType.WITHDRAWAL&&current.accountMode===AccountMode.DEMO;
			const settlementReference=completesWithdrawal?`SIMULATED-WITHDRAWAL:${current.id}`:null;
			const finalStatus=completesWithdrawal||input.decision==='APPROVED'?completesWithdrawal?FundingStatus.COMPLETED:FundingStatus.APPROVED:FundingStatus.REJECTED;
			const changed=await tx.fundingRequest.updateMany({where:{id:current.id,status:{in:pendingStatuses}},data:{status:finalStatus,adminNote:input.note||null,reviewedAt,verifiedAt:bitcoinDeposit?current.verifiedAt:null,creditedAmount:approvedCredit,creditedCurrency:approvedCredit?creditCurrency:null,settledAt:completesWithdrawal?reviewedAt:null,settlementReference}});
			if(changed.count!==1)throw new Error('FUNDING_ALREADY_REVIEWED');
			let previousBalance:Prisma.Decimal|null=null;
			let resultingBalance:Prisma.Decimal|null=null;
			if(input.decision==='APPROVED'){
				const ledgerCurrency=bitcoinDeposit?'USD':current.currency;
				const account=await ensureUserLedger(tx,current.userId,current.accountMode,ledgerCurrency);
				previousBalance=await balance(tx,account.id);
				const system=await ensureSystemAccount(tx,bitcoinDeposit?'SYSTEM:BTC:VERIFIED_DEPOSIT:REAL:USD':`SYSTEM:SIMULATION:${current.type}:${current.accountMode}:${current.currency}`,bitcoinDeposit?'Manually verified Bitcoin deposit clearing':`Internal simulated ${current.type.toLowerCase()} clearing`,ledgerCurrency,current.accountMode);
				if(current.type===FundingType.DEPOSIT){
					await postDoubleEntry(tx,{reference:`FUNDING:${current.id}:APPROVED`,description:bitcoinDeposit?'Admin-approved manually verified BTC deposit · USD wallet credit':`Admin approved internal simulated ${current.accountMode} deposit`,debitAccountId:system.id,creditAccountId:account.id,amount:approvedCredit!});
				}else if(current.accountMode===AccountMode.DEMO){
					const pending=await tx.fundingRequest.aggregate({where:{userId:current.userId,accountMode:current.accountMode,currency:current.currency,type:FundingType.WITHDRAWAL,status:{in:reservingStatuses},id:{not:current.id}},_sum:{amount:true}});
					if(previousBalance.lt(current.amount.plus(pending._sum.amount??new Prisma.Decimal(0))))throw new Error('INSUFFICIENT_FUNDS');
					await postDoubleEntry(tx,{reference:`FUNDING:${current.id}:APPROVED`,description:`Admin completed internal simulated ${current.accountMode} withdrawal`,debitAccountId:account.id,creditAccountId:system.id,amount:current.amount});
				}else{
					const withdrawable=await getRealWithdrawableBalance(tx,current.userId,previousBalance,current.id);
					if(withdrawable.lt(current.amount))throw new Error('INSUFFICIENT_WITHDRAWABLE_FUNDS');
				}
				resultingBalance=current.type===FundingType.WITHDRAWAL&&current.accountMode===AccountMode.REAL?previousBalance:await balance(tx,account.id);
			}
			const updated=await tx.fundingRequest.findUniqueOrThrow({where:{id:current.id}});
			await tx.auditLog.create({data:{actorId:admin.id,action:bitcoinDeposit?input.decision==='APPROVED'?'BTC_DEPOSIT_APPROVED':'BTC_DEPOSIT_REJECTED':`FUNDING_${input.decision}`,entity:'FUNDING',entityId:updated.id,metadata:{type:updated.type,accountMode:updated.accountMode,currency:updated.currency,requestedAmount:updated.amount.toString(),creditedAmount:updated.creditedAmount?.toString()??null,creditedCurrency:updated.creditedCurrency,simulated:!bitcoinDeposit,manualVerification:bitcoinDeposit,verifiedAt:updated.verifiedAt,transactionReference:updated.transactionReference,settlementReference:updated.settlementReference,previousBalance:previousBalance?.toString()??null,resultingBalance:resultingBalance?.toString()??null}}});
			const notificationType=updated.type===FundingType.DEPOSIT?NotificationType.DEPOSIT:NotificationType.WITHDRAWAL;
			const decisionLabel=input.decision==='APPROVED'?'approved':'rejected';
			const realWithdrawalAwaitingCompletion=updated.type===FundingType.WITHDRAWAL&&updated.accountMode===AccountMode.REAL&&input.decision==='APPROVED';
			await createNotification(tx,{userId:updated.userId,type:notificationType,title:bitcoinDeposit?`BTC deposit ${decisionLabel} · REAL wallet`:updated.type==='WITHDRAWAL'&&updated.accountMode===AccountMode.DEMO&&input.decision==='APPROVED'?'Simulated withdrawal approved for processing':realWithdrawalAwaitingCompletion?'REAL withdrawal approved · payout not configured':`${updated.type==='DEPOSIT'?'Deposit':'Withdrawal'} ${decisionLabel}`,message:bitcoinDeposit?input.decision==='APPROVED'?`An administrator manually verified your BTC transaction and credited ${updated.creditedAmount?.toString()} USD to your Aurevia REAL internal wallet. This does not transfer Alpaca Paper cash or profits into your wallet.`:`Your BTC deposit request was rejected and no REAL wallet credit was made.${input.note?` Admin note: ${input.note}`:''}`:updated.type==='DEPOSIT'&&input.decision==='APPROVED'&&updated.accountMode===AccountMode.REAL?`Your simulated REAL balance was credited by ${updated.creditedAmount?.toString()||updated.amount.toString()} ${updated.currency}. This is a simulated ledger entry; no payment was processed and no money moved.`:updated.type==='DEPOSIT'&&input.decision==='APPROVED'?`Your DEMO deposit request was credited by ${updated.creditedAmount?.toString()||updated.amount.toString()} ${updated.currency} in the simulated ledger.`:realWithdrawalAwaitingCompletion?`Your REAL withdrawal of ${updated.amount.toString()} ${updated.currency} is approved and reserved in the internal ledger. An external payout provider is not configured, so the request remains incomplete and no money moves.`:updated.type==='WITHDRAWAL'&&updated.accountMode===AccountMode.DEMO&&input.decision==='APPROVED'?`Your simulated withdrawal of ${updated.amount.toString()} ${updated.currency} is approved and reserved, but it has not been completed. Further administrator execution confirmation is required.`:`Your ${updated.type.toLowerCase()} request was ${decisionLabel}.${input.note?` Admin note: ${input.note}`:''}`,dedupeKey:`funding:${updated.id}:${input.decision.toLowerCase()}`,relatedEntity:'FUNDING',relatedId:updated.id,actionUrl:`/wallet/transactions/${updated.id}`});
			return updated;
		},{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,maxWait:5_000,timeout:15_000});
		const user=await db.user.findUnique({where:{id:request.userId},select:{email:true}});
		const delivery=user?await sendSupportEmail(`Funding request ${input.decision.toLowerCase()}`,[`Request: ${request.id}`,`User: ${request.userId}`,`Type: ${request.type}`,`Mode: ${request.accountMode}`,`Status: ${request.status}`,request.currency==='BTC'?`BTC requested: ${request.amount.toString()}; credited amount: ${request.creditedAmount?.toString()??'none'} ${request.creditedCurrency??''}; manual verification state: ${request.verifiedAt?'verified':'not verified'}. No blockchain confirmation is asserted.`:request.type===FundingType.WITHDRAWAL&&request.accountMode===AccountMode.REAL?'REAL withdrawal remains reserved; no external payout provider is configured and no transfer is completed.':'The internal ledger is updated only for an approved deposit.'].join('\n')):{sent:false as const,reason:'failed' as const};
		const {receiptKey,...safeRequest}=request;
		return NextResponse.json({...jsonSafe(safeRequest),hasReceipt:!!receiptKey,emailDelivery:delivery.sent?'sent':delivery.reason||'failed'},{headers:{'Cache-Control':'private, no-store'}});
	}catch(error){
		if(error instanceof ZodError)return NextResponse.json({error:'Invalid review details.'},{status:400});
		if(error instanceof Error&&error.message==='UNAUTHORIZED')return NextResponse.json({error:'Unauthorized'},{status:401});
		if(error instanceof Error&&error.message==='FORBIDDEN')return NextResponse.json({error:'Forbidden'},{status:403});
		if(error instanceof Error&&error.message==='FUNDING_SELF_REVIEW_FORBIDDEN')return NextResponse.json({error:'Administrators cannot review their own funding requests.'},{status:403});
		if(error instanceof Error&&error.message==='BTC_DEPOSIT_REQUIRED')return NextResponse.json({error:'Manual verification is available only for REAL Bitcoin deposit requests.'},{status:409});
		if(error instanceof Error&&error.message==='BTC_DEPOSIT_RECORD_INVALID')return NextResponse.json({error:'This BTC funding record is invalid and cannot be approved.'},{status:409});
		if(error instanceof Error&&error.message==='BTC_DEPOSIT_EVIDENCE_INCOMPLETE')return NextResponse.json({error:'A private receipt screenshot and, if supplied, a valid transaction ID are required.'},{status:409});
		if(error instanceof Error&&error.message==='BTC_DEPOSIT_NOT_VERIFIED')return NextResponse.json({error:'Manually verify the Bitcoin transaction and receipt before approving a wallet credit.'},{status:409});
		if(error instanceof Error&&error.message==='BTC_USD_CREDIT_REQUIRED')return NextResponse.json({error:'Enter the USD credit amount after manually verifying the Bitcoin transaction.'},{status:400});
		if(error instanceof Error&&error.message==='INVALID_ROUNDED_CREDIT')return NextResponse.json({error:'Enter a positive USD amount with at least one cent to credit.'},{status:400});
		if(error instanceof Error&&['FUNDING_NOT_PENDING','FUNDING_ALREADY_REVIEWED','INSUFFICIENT_FUNDS','INSUFFICIENT_WITHDRAWABLE_FUNDS','WITHDRAWAL_RESTRICTED','CREDIT_EXCEEDS_REQUEST','DEPOSIT_AMOUNT_MISMATCH','DEPOSIT_RECEIPT_REQUIRED'].includes(error.message))return NextResponse.json({error:error.message==='DEPOSIT_RECEIPT_REQUIRED'?'Upload and review payment evidence before approving this payment-method deposit.':error.message.replaceAll('_',' ').toLowerCase()},{status:409});
		return NextResponse.json({error:'Funding review failed.'},{status:400});
	}
}
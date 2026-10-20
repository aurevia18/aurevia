import {randomUUID} from 'node:crypto';
import {NextResponse} from 'next/server';
import {FundingStatus,FundingType,NotificationType,Prisma} from '@prisma/client';
import {z,ZodError} from 'zod';
import {requireAdmin} from '@/lib/auth';
import {db} from '@/lib/db';
import {balance,ensureSystemAccount,ensureUserLedger,postDoubleEntry} from '@/lib/ledger';
import {createNotification} from '@/lib/notifications';
import {jsonSafe} from '@/lib/serializers';

const schema=z.object({id:z.string().min(1),note:z.string().trim().max(500).optional()});
const reservingStatuses=[FundingStatus.PENDING,FundingStatus.PENDING_REVIEW,FundingStatus.APPROVED,FundingStatus.PROCESSING];

export async function POST(req:Request){
	try{
		const admin=await requireAdmin();
		const input=schema.parse(await req.json());
		const request=await db.$transaction(async tx=>{
			const current=await tx.fundingRequest.findUnique({where:{id:input.id}});
			if(!current||current.type!==FundingType.WITHDRAWAL||current.status!==FundingStatus.APPROVED)throw new Error('WITHDRAWAL_NOT_APPROVED');
			if(current.accountMode==='DEMO')throw new Error('DEMO_WITHDRAWAL_DISABLED');
			if(current.accountMode==='REAL')throw new Error('REAL_PAYOUT_NOT_CONFIGURED');
			if(current.userId===admin.id)throw new Error('WITHDRAWAL_SELF_SETTLEMENT_FORBIDDEN');
			const user=await tx.user.findUnique({where:{id:current.userId},select:{withdrawalEnabled:true,accountRestricted:true}});
			if(!user?.withdrawalEnabled||user.accountRestricted)throw new Error('WITHDRAWAL_RESTRICTED');
			const account=await ensureUserLedger(tx,current.userId,current.accountMode,current.currency);
			const available=await balance(tx,account.id);
			const otherReservations=await tx.fundingRequest.aggregate({
				where:{userId:current.userId,accountMode:current.accountMode,currency:current.currency,type:FundingType.WITHDRAWAL,status:{in:reservingStatuses},id:{not:current.id}},
				_sum:{amount:true},
			});
			if(available.lt(current.amount.plus(otherReservations._sum.amount??new Prisma.Decimal(0))))throw new Error('INSUFFICIENT_FUNDS');
			const settlementReference=`SIMULATED-${randomUUID()}`;
			const changed=await tx.fundingRequest.updateMany({
				where:{id:current.id,status:FundingStatus.APPROVED,settlementReference:null},
				data:{status:FundingStatus.COMPLETED,settlementReference,settledAt:new Date(),adminNote:input.note||current.adminNote},
			});
			if(changed.count!==1)throw new Error('WITHDRAWAL_ALREADY_SETTLED');
			const system=await ensureSystemAccount(tx,`SYSTEM:SIMULATION:WITHDRAWAL:${current.accountMode}:${current.currency}`,`Internal simulated ${current.accountMode} withdrawal clearing`,current.currency,current.accountMode);
			await postDoubleEntry(tx,{reference:`FUNDING:${current.id}:SETTLED`,description:`Completed simulated ${current.accountMode} withdrawal`,debitAccountId:account.id,creditAccountId:system.id,amount:current.amount});
			await tx.auditLog.create({data:{actorId:admin.id,action:'SIMULATED_WITHDRAWAL_SETTLED',entity:'FUNDING',entityId:current.id,metadata:{accountMode:current.accountMode,type:current.type,amount:current.amount.toString(),currency:current.currency,settlementReference,simulated:true,note:input.note||null}}});
			await createNotification(tx,{userId:current.userId,type:NotificationType.WITHDRAWAL,title:'Simulated withdrawal completed',message:`Your simulated ${current.accountMode} withdrawal of ${current.amount.toString()} ${current.currency} has been completed in the internal ledger. No external money was paid.`,dedupeKey:`funding:${current.id}:settled`,relatedEntity:'FUNDING',relatedId:current.id,actionUrl:`/wallet/transactions/${current.id}`});
			return tx.fundingRequest.findUniqueOrThrow({where:{id:current.id}});
		},{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,maxWait:5_000,timeout:15_000});
		const {receiptKey,...safeRequest}=request;
		return NextResponse.json({...jsonSafe(safeRequest),hasReceipt:!!receiptKey},{headers:{'Cache-Control':'private, no-store'}});
	}catch(error){
		if(error instanceof ZodError)return NextResponse.json({error:'Enter a valid withdrawal request and optional audit note.'},{status:400});
		if(error instanceof Error&&error.message==='UNAUTHORIZED')return NextResponse.json({error:'Unauthorized'},{status:401});
		if(error instanceof Error&&error.message==='FORBIDDEN')return NextResponse.json({error:'Forbidden'},{status:403});
		if(error instanceof Error&&error.message==='DEMO_WITHDRAWAL_DISABLED')return NextResponse.json({error:'DEMO withdrawals are disabled. A legacy reservation may only be released as failed.'},{status:409});
		if(error instanceof Error&&['WITHDRAWAL_NOT_APPROVED','WITHDRAWAL_RESTRICTED','INSUFFICIENT_FUNDS','WITHDRAWAL_ALREADY_SETTLED','WITHDRAWAL_SELF_SETTLEMENT_FORBIDDEN','REAL_PAYOUT_NOT_CONFIGURED'].includes(error.message))return NextResponse.json({error:error.message==='REAL_PAYOUT_NOT_CONFIGURED'?'A REAL external payout provider is not configured. The approved request remains reserved and is not marked complete.':error.message.replaceAll('_',' ').toLowerCase()},{status:409});
		console.error('[admin-funding-settle] Simulated withdrawal settlement failed',error instanceof Error?error.name:'UnknownError');
		return NextResponse.json({error:'Unable to complete the simulated withdrawal.'},{status:500});
	}
}

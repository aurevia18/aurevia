import {AccountMode,EntryType,NotificationType,Prisma,UserStatus} from '@prisma/client';
import {NextResponse} from 'next/server';
import {z,ZodError} from 'zod';
import {requireAdmin} from '@/lib/auth';
import {db} from '@/lib/db';
import {createNotification} from '@/lib/notifications';
import {balance,ensureSystemAccount,ensureUserLedger,reservedWithdrawalAmount} from '@/lib/ledger';
import {SUPPORTED_CURRENCIES} from '@/lib/config/simulation';

const schema=z.object({
	userId:z.string().min(1),
	accountMode:z.nativeEnum(AccountMode),
	currency:z.enum(SUPPORTED_CURRENCIES),
	amount:z.string().regex(/^(?:0|[1-9]\d{0,7})(?:\.\d{1,2})?$/),
	direction:z.enum(['CREDIT','DEBIT']),
	category:z.enum(['ADMIN_ALLOCATION','CORRECTION','PROMOTIONAL','REVERSAL']),
	reason:z.string().trim().min(3).max(300),
	idempotencyKey:z.string().uuid(),
});

export async function POST(request:Request){
	try{
		const admin=await requireAdmin();
		const input=schema.parse(await request.json());
		const amount=new Prisma.Decimal(input.amount);
		if(amount.lte(0))return NextResponse.json({error:'Amount must be greater than zero.'},{status:400});
		const reference=`ADMIN:${input.accountMode}:${input.userId}:${input.idempotencyKey}`;
		const description=`Administrative ${input.direction.toLowerCase()} · ${input.category} · ${input.reason}`;
		const result=await db.$transaction(async tx=>{
			const prior=await tx.ledgerTransaction.findUnique({where:{reference},include:{entries:{include:{account:{select:{userId:true,accountMode:true,currency:true}}}}}});
			if(prior){
				if(prior.description!==description||prior.accountMode!==input.accountMode||!prior.entries.some(entry=>entry.account.userId===input.userId&&entry.account.accountMode===input.accountMode&&entry.account.currency===input.currency&&entry.amount.eq(amount)&&entry.type===(input.direction==='CREDIT'?EntryType.CREDIT:EntryType.DEBIT)))throw new Error('IDEMPOTENCY_KEY_REUSED');
				return {reference,transactionId:prior.id,createdAt:prior.createdAt.toISOString(),replayed:true};
			}
			const customer=await tx.user.findUnique({where:{id:input.userId},select:{id:true,role:true,status:true}});
			if(!customer||customer.role!=='USER')throw new Error('CUSTOMER_ACCOUNT_REQUIRED');
			if(customer.status!==UserStatus.ACTIVE)throw new Error('ACCOUNT_NOT_ACTIVE');
			const account=await ensureUserLedger(tx,customer.id,input.accountMode,input.currency);
			const availableBefore=await balance(tx,account.id);
			const reserved=input.direction==='DEBIT'?await reservedWithdrawalAmount(tx,customer.id,input.accountMode,input.currency):new Prisma.Decimal(0);
			if(input.direction==='DEBIT'&&availableBefore.lt(amount.plus(reserved)))throw new Error('INSUFFICIENT_BALANCE');
			const offset=await ensureSystemAccount(tx,`SYSTEM:ADMIN:${input.accountMode}:${input.currency}`,`Administrator ${input.accountMode} adjustment clearing`,input.currency,input.accountMode);
			const debitAccount=input.direction==='CREDIT'?offset:account;
			const creditAccount=input.direction==='CREDIT'?account:offset;
			const transaction=await tx.ledgerTransaction.create({data:{reference,description,accountMode:input.accountMode,entries:{create:[{account:{connect:{id:debitAccount.id}},accountMode:input.accountMode,type:EntryType.DEBIT,amount},{account:{connect:{id:creditAccount.id}},accountMode:input.accountMode,type:EntryType.CREDIT,amount}]}}});
			const availableAfter=await balance(tx,account.id);
			await tx.auditLog.create({data:{actorId:admin.id,action:`ADMIN_ACCOUNT_${input.direction}`,entity:'LEDGER_TRANSACTION',entityId:transaction.id,metadata:{userId:customer.id,accountMode:input.accountMode,currency:input.currency,amount:amount.toString(),category:input.category,reason:input.reason,reference,previousBalance:availableBefore.toString(),newBalance:availableAfter.toString(),administrativeRealAllocation:input.accountMode===AccountMode.REAL}}});
			await createNotification(tx,{userId:customer.id,type:NotificationType.ACCOUNT,title:`${input.accountMode} account ${input.direction.toLowerCase()} recorded`,message:`An administrator recorded a ${input.direction.toLowerCase()} of ${amount.toFixed(2)} ${input.currency} in your ${input.accountMode} account (${input.category}). Reason: ${input.reason}. Reference: ${reference}.${input.accountMode===AccountMode.REAL?' These are simulated ledger funds; no external payment or asset transfer occurred.':' This is virtual simulated account activity.'}`,dedupeKey:`admin-ledger:${reference}`,relatedEntity:'LEDGER_TRANSACTION',relatedId:transaction.id,actionUrl:'/wallet/transactions'});
			return {reference,transactionId:transaction.id,createdAt:transaction.createdAt.toISOString(),replayed:false,previousBalance:availableBefore.toString(),newBalance:availableAfter.toString()};
		},{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
		return NextResponse.json(result,{status:result.replayed?200:201,headers:{'Cache-Control':'private, no-store'}});
	}catch(error){
		if(error instanceof ZodError)return NextResponse.json({error:'Enter a valid user, account, amount, category, reason, and unique request key.'},{status:400});
		if(error instanceof Error&&error.message==='UNAUTHORIZED')return NextResponse.json({error:'Unauthorized'},{status:401});
		if(error instanceof Error&&error.message==='FORBIDDEN')return NextResponse.json({error:'Forbidden'},{status:403});
		if(error instanceof Error&&error.message==='IDEMPOTENCY_KEY_REUSED')return NextResponse.json({error:'This request key has already been used for a different adjustment.'},{status:409});
		if(error instanceof Error&&error.message==='CUSTOMER_ACCOUNT_REQUIRED')return NextResponse.json({error:'Select an existing customer account.'},{status:409});
		if(error instanceof Error&&error.message==='ACCOUNT_NOT_ACTIVE')return NextResponse.json({error:'Only active customer accounts can be adjusted.'},{status:409});
		if(error instanceof Error&&error.message==='INSUFFICIENT_BALANCE')return NextResponse.json({error:'The selected account does not have enough available balance for this debit.'},{status:409});
		if(error&&typeof error==='object'&&'code' in error&&String(error.code)==='P2034')return NextResponse.json({error:'The account changed during this adjustment. Retry with the same request key.'},{status:409});
		console.error('Administrative balance adjustment failed.',error&&typeof error==='object'&&'code' in error?String(error.code):error instanceof Error?error.name:'UnknownError');
		return NextResponse.json({error:'Unable to record this account adjustment.'},{status:503});
	}
}

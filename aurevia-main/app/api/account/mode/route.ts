import {NextResponse} from 'next/server';
import {z,ZodError} from 'zod';
import {AccountMode,NotificationType,Prisma} from '@prisma/client';
import {requireUser} from '@/lib/auth';
import {db} from '@/lib/db';
import {createNotification} from '@/lib/notifications';
import {PAPER_STARTING_BALANCE,initializePaperAccount} from '@/lib/ledger';

const schema=z.object({accountMode:z.nativeEnum(AccountMode)});

export async function PATCH(req:Request){
	try{
		const user=await requireUser();
		const {accountMode}=schema.parse(await req.json());
		const updated=await db.$transaction(async tx=>{
			const current=await tx.user.findUniqueOrThrow({where:{id:user.id},select:{accountMode:true}});
			const paperAccountInitialized=await initializePaperAccount(tx,user.id,accountMode);
			const changed=await tx.user.update({where:{id:user.id},data:{accountMode},select:{accountMode:true,updatedAt:true}});
			if(current.accountMode!==accountMode||paperAccountInitialized){
				await tx.auditLog.create({data:{actorId:user.id,action:current.accountMode===accountMode?`${accountMode}_PAPER_ACCOUNT_INITIALIZED`:'ACCOUNT_MODE_CHANGED',entity:current.accountMode===accountMode?'LEDGER_ACCOUNT':'USER',entityId:user.id,metadata:{from:current.accountMode,to:accountMode,paperAccountInitialized}}});
				await createNotification(tx,{userId:user.id,type:NotificationType.ACCOUNT,title:paperAccountInitialized?`${accountMode} paper account initialized`:'Account mode changed',message:paperAccountInitialized?`Your separate ${accountMode} paper account received ${PAPER_STARTING_BALANCE.toFixed(2)} virtual USD. No funds were transferred between modes.`:`Your active paper account is now ${accountMode}. Balances and activity remain separate by mode.`,dedupeKey:`account-mode:${user.id}:${changed.updatedAt.toISOString()}`,actionUrl:'/dashboard'});
			}
			return {accountMode:changed.accountMode,paperAccountInitialized};
		},{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,maxWait:5_000,timeout:15_000});
		return NextResponse.json(updated);
	}catch(error){
		if(error instanceof ZodError)return NextResponse.json({error:'Select a valid account mode.'},{status:400});
		if(error instanceof Error&&error.message==='UNAUTHORIZED')return NextResponse.json({error:'Unauthorized'},{status:401});
		if(error instanceof Error&&error.message==='FORBIDDEN')return NextResponse.json({error:'Forbidden'},{status:403});
		if(error&&typeof error==='object'&&'code'in error&&String(error.code)==='P2034')return NextResponse.json({error:'The account changed while switching modes. Retry the request.'},{status:409});
		console.error('Account mode update failed.',error&&typeof error==='object'&&'code'in error?String(error.code):error instanceof Error?error.name:'UnknownError');
		return NextResponse.json({error:'Unable to update account mode.'},{status:503});
	}
}
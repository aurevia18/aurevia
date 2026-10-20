import {FundingStatus,FundingType,Prisma,PrismaClient} from '@prisma/client';

type TransactionClient=PrismaClient|Prisma.TransactionClient;

const reservingStatuses=[FundingStatus.PENDING,FundingStatus.PENDING_REVIEW,FundingStatus.APPROVED,FundingStatus.PROCESSING];

export function calculateRealWithdrawableBalance(input:{ledgerBalance:Prisma.Decimal|string|number;pendingWithdrawals:Prisma.Decimal|string|number}){
	return Prisma.Decimal.max(0,new Prisma.Decimal(input.ledgerBalance).minus(input.pendingWithdrawals));
}

export async function getRealWithdrawableBalance(tx:TransactionClient,userId:string,ledgerBalance:Prisma.Decimal,excludePendingRequestId?:string){
	const pendingWithdrawals=await tx.fundingRequest.aggregate({
			where:{userId,accountMode:'REAL',type:FundingType.WITHDRAWAL,currency:'USD',status:{in:reservingStatuses},...(excludePendingRequestId?{id:{not:excludePendingRequestId}}:{})},
			_sum:{amount:true},
		});
	return calculateRealWithdrawableBalance({
		ledgerBalance,
		pendingWithdrawals:pendingWithdrawals._sum.amount??0,
	});
}

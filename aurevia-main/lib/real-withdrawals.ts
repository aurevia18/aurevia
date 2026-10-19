import {FundingStatus,FundingType,Prisma,PrismaClient} from '@prisma/client';
import {BTC_FUNDING_METHOD} from '@/lib/bitcoin-funding';

type TransactionClient=PrismaClient|Prisma.TransactionClient;

const reservingStatuses=[FundingStatus.PENDING,FundingStatus.PENDING_REVIEW,FundingStatus.APPROVED,FundingStatus.PROCESSING];

export function calculateRealWithdrawableBalance(input:{
	ledgerBalance:Prisma.Decimal|string|number;
	verifiedBtcCredits:Prisma.Decimal|string|number;
	completedWithdrawals:Prisma.Decimal|string|number;
	pendingWithdrawals:Prisma.Decimal|string|number;
}){
	const ledgerAvailable=Prisma.Decimal.max(new Prisma.Decimal(0),new Prisma.Decimal(input.ledgerBalance).minus(input.pendingWithdrawals));
	const fundedAvailable=Prisma.Decimal.max(new Prisma.Decimal(0),new Prisma.Decimal(input.verifiedBtcCredits).minus(input.completedWithdrawals).minus(input.pendingWithdrawals));
	return Prisma.Decimal.min(ledgerAvailable,fundedAvailable);
}

export async function getRealWithdrawableBalance(tx:TransactionClient,userId:string,ledgerBalance:Prisma.Decimal,excludePendingRequestId?:string){
	const [verifiedBtcCredits,completedWithdrawals,pendingWithdrawals]=await Promise.all([
		tx.fundingRequest.aggregate({
			where:{userId,accountMode:'REAL',type:FundingType.DEPOSIT,currency:'BTC',method:BTC_FUNDING_METHOD,creditedCurrency:'USD',status:{in:[FundingStatus.APPROVED,FundingStatus.COMPLETED]}},
			_sum:{creditedAmount:true},
		}),
		tx.fundingRequest.aggregate({
			where:{userId,accountMode:'REAL',type:FundingType.WITHDRAWAL,currency:'USD',status:FundingStatus.COMPLETED},
			_sum:{amount:true},
		}),
		tx.fundingRequest.aggregate({
			where:{userId,accountMode:'REAL',type:FundingType.WITHDRAWAL,currency:'USD',status:{in:reservingStatuses},...(excludePendingRequestId?{id:{not:excludePendingRequestId}}:{})},
			_sum:{amount:true},
		}),
	]);
	return calculateRealWithdrawableBalance({
		ledgerBalance,
		verifiedBtcCredits:verifiedBtcCredits._sum.creditedAmount??0,
		completedWithdrawals:completedWithdrawals._sum.amount??0,
		pendingWithdrawals:pendingWithdrawals._sum.amount??0,
	});
}

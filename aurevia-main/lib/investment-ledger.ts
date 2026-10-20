import {AccountMode,Prisma} from '@prisma/client';
import {ensureSystemAccount,ensureUserLedger,postDoubleEntry} from '@/lib/ledger';

export async function postSimulatedInvestmentPayout(tx:Prisma.TransactionClient,input:{
	investmentId:string;
	userId:string;
	accountMode:AccountMode;
	principal:Prisma.Decimal;
	payout:Prisma.Decimal;
	opportunityTitle:string;
}){
	if(input.payout.lte(0))return;
	const escrow=await ensureSystemAccount(tx,`SYSTEM:INVESTMENT_ESCROW:${input.accountMode}:USD`,`${input.accountMode} simulated investment escrow`,'USD',input.accountMode);
	const userAccount=await ensureUserLedger(tx,input.userId,input.accountMode,'USD');
	const principalReturn=Prisma.Decimal.min(input.principal,input.payout);
	await postDoubleEntry(tx,{reference:`INVESTMENT:${input.investmentId}:PAYOUT`,description:`Return simulated investment principal for ${input.opportunityTitle}`,debitAccountId:escrow.id,creditAccountId:userAccount.id,amount:principalReturn});
	const earnings=input.payout.minus(principalReturn);
	if(earnings.gt(0)){
		const earningsAccount=await ensureSystemAccount(tx,`SYSTEM:SIMULATED_INVESTMENT_EARNINGS:${input.accountMode}:USD`,`${input.accountMode} simulated investment earnings expense`,'USD',input.accountMode);
		await postDoubleEntry(tx,{reference:`INVESTMENT:${input.investmentId}:EARNINGS`,description:`Credit simulated investment earnings for ${input.opportunityTitle}`,debitAccountId:earningsAccount.id,creditAccountId:userAccount.id,amount:earnings});
	}
}

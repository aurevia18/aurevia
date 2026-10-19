import {Prisma} from '@prisma/client';
import {db} from '@/lib/db';
import {nextPrice} from '@/lib/market';
import {principalOnlySettlement} from '@/lib/investment-policy';

export type InternalServiceStatus='AVAILABLE'|'UNAVAILABLE';

async function check(operation:()=>Promise<void>):Promise<InternalServiceStatus>{
	try{await operation();return 'AVAILABLE'}catch{return 'UNAVAILABLE'}
}

async function checkLedger(){
	await db.ledgerAccount.count();
	const transactions=await db.ledgerTransaction.findMany({take:100,orderBy:{createdAt:'desc'},include:{entries:{select:{type:true,amount:true}}}});
	for(const transaction of transactions){
		const debit=transaction.entries.filter(entry=>entry.type==='DEBIT').reduce((sum,entry)=>sum.plus(entry.amount),new Prisma.Decimal(0));
		const credit=transaction.entries.filter(entry=>entry.type==='CREDIT').reduce((sum,entry)=>sum.plus(entry.amount),new Prisma.Decimal(0));
		if(transaction.entries.length<2||!debit.equals(credit))throw new Error('LEDGER_INTEGRITY_FAILED');
	}
}

async function checkTradeSimulation(){
	const instrument=await db.instrument.findFirst({where:{enabled:true},orderBy:{updatedAt:'desc'},select:{price:true,updatedAt:true}});
	if(!instrument||Number(instrument.price)<=0||Date.now()-instrument.updatedAt.getTime()>60_000)throw new Error('SIMULATED_MARKET_UNAVAILABLE');
	const next=nextPrice(Number(instrument.price));
	if(!Number.isFinite(next)||next<=0)throw new Error('SIMULATION_PRICE_INVALID');
	await db.order.count();
	await db.execution.count();
}

async function checkFunding(){
	await db.fundingRequest.count();
	await db.ledgerTransaction.count();
}

async function checkInvestments(){
	await db.investmentRequest.count();
	const payout=principalOnlySettlement(new Prisma.Decimal(1));
	if(!payout.equals(1))throw new Error('SIMULATED_INVESTMENT_CALCULATION_FAILED');
}

export async function getInternalSimulationHealth(adminAuthorized:boolean){
	const [database,accountLedger,tradeExecution,funding,investmentSettlement]=await Promise.all([
		check(async()=>{await db.$queryRaw`SELECT 1`}),
		check(checkLedger),
		check(checkTradeSimulation),
		check(checkFunding),
		check(checkInvestments),
	]);
	const simulationEngine=database==='AVAILABLE'&&tradeExecution==='AVAILABLE'?'AVAILABLE':'UNAVAILABLE';
	return {
		checkedAt:new Date().toISOString(),
		simulationEngine,
		accountLedger,
		adminAuthorization:adminAuthorized?'AVAILABLE':'UNAVAILABLE' as InternalServiceStatus,
		simulatedTradeExecution:tradeExecution,
		simulatedDepositsAndWithdrawals:database==='AVAILABLE'&&accountLedger==='AVAILABLE'&&funding==='AVAILABLE'?'AVAILABLE':'UNAVAILABLE' as InternalServiceStatus,
		simulatedInvestmentSettlement:database==='AVAILABLE'&&accountLedger==='AVAILABLE'&&investmentSettlement==='AVAILABLE'?'AVAILABLE':'UNAVAILABLE' as InternalServiceStatus,
		externalBrokerExecution:'DISABLED' as const,
		externalPaymentProcessing:'DISABLED' as const,
		externalInvestmentSettlement:'DISABLED' as const,
		externalMoneyMovement:'DISABLED' as const,
		database,
		funding,
		investmentSettlement,
	};
}
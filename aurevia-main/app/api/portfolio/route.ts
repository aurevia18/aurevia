import {NextResponse} from 'next/server';
import {AccountMode,FundingStatus,FundingType,InvestmentStatus,Prisma} from '@prisma/client';
import {requireUser} from '@/lib/auth';
import {db} from '@/lib/db';
import {balance} from '@/lib/ledger';
import {BTC_FUNDING_METHOD} from '@/lib/bitcoin-funding';
import {recordedInvestmentPnl} from '@/lib/investment-policy';
import {calculateAllocationPercentages,instrumentAssetCategory} from '@/lib/portfolio-metrics';
import {jsonSafe} from '@/lib/serializers';

export const dynamic='force-dynamic';

const zero=()=>new Prisma.Decimal(0);
const activeInvestmentStatuses:Set<InvestmentStatus>=new Set([InvestmentStatus.PENDING_APPROVAL,InvestmentStatus.APPROVED,InvestmentStatus.ACTIVE,InvestmentStatus.PAUSED,InvestmentStatus.COMPLETED]);

export async function GET(){
 try{
  const user=await requireUser();
  const mode=user.accountMode;
  const [account,positions,realizedAggregate,investments,settledInvestments,depositAggregate,withdrawalAggregate]=await Promise.all([
   db.ledgerAccount.findUnique({where:{code:`USER:${user.id}:${mode}:USD`},select:{id:true,startingBalance:true}}),
   db.position.findMany({where:{userId:user.id,accountMode:mode,status:'OPEN'},include:{instrument:true},orderBy:{openedAt:'asc'}}),
   db.position.aggregate({where:{userId:user.id,accountMode:mode},_sum:{realizedPnl:true}}),
   db.investmentRequest.findMany({where:{userId:user.id,accountMode:mode},include:{opportunity:{select:{title:true,category:true,assetSymbol:true,riskLevel:true,durationDays:true}}},orderBy:{requestedAt:'desc'}}),
   db.investmentRequest.findMany({where:{userId:user.id,accountMode:mode,status:InvestmentStatus.SETTLED},select:{amount:true,simulatedPayout:true}}),
   db.fundingRequest.aggregate({
    where:mode===AccountMode.REAL
     ?{userId:user.id,accountMode:mode,type:FundingType.DEPOSIT,currency:'BTC',method:BTC_FUNDING_METHOD,creditedCurrency:'USD',status:{in:[FundingStatus.APPROVED,FundingStatus.COMPLETED]}}
     :{userId:user.id,accountMode:mode,currency:'USD',type:FundingType.DEPOSIT,status:{in:[FundingStatus.APPROVED,FundingStatus.COMPLETED]}},
    _sum:{amount:true,creditedAmount:true},
   }),
   db.fundingRequest.aggregate({where:{userId:user.id,accountMode:mode,currency:'USD',type:FundingType.WITHDRAWAL,status:{in:[FundingStatus.APPROVED,FundingStatus.COMPLETED]}},_sum:{amount:true}}),
  ]);
  const cashBalance=account?await balance(db,account.id):zero();
  let positionValue=zero();
  let unrealizedPnl=zero();
  const valuedPositions=positions.map(position=>{
   const currentPrice=position.instrument.price;
   const marketValue=currentPrice.mul(position.quantity);
   const direction=position.side==='BUY'?1:-1;
   const positionPnl=position.entryPrice.mul(-direction).plus(currentPrice.mul(direction)).mul(position.quantity);
   positionValue=positionValue.plus(marketValue);
   unrealizedPnl=unrealizedPnl.plus(positionPnl);
   return {...position,currentPrice,marketValue,unrealizedPnl:positionPnl};
  });
  const investedRequests=investments.filter(item=>activeInvestmentStatuses.has(item.status));
  const investmentValue=investedRequests.reduce((sum,item)=>sum.plus(item.amount),zero());
  const settledInvestmentPnl=settledInvestments.reduce((sum,item)=>sum.plus(recordedInvestmentPnl(item.amount,item.simulatedPayout)),zero());
  const realizedPnl=new Prisma.Decimal(realizedAggregate._sum.realizedPnl??0).plus(settledInvestmentPnl);
  const totalPnl=realizedPnl.plus(unrealizedPnl);
  const totalValue=cashBalance.plus(positionValue).plus(investmentValue);
  const netDemoFunding=mode===AccountMode.DEMO?new Prisma.Decimal(depositAggregate._sum.amount??0).minus(withdrawalAggregate._sum.amount??0):zero();
  const startingBalance=account?.startingBalance??zero();
  const returnBasis=mode===AccountMode.REAL?new Prisma.Decimal(depositAggregate._sum.creditedAmount??0):startingBalance.plus(netDemoFunding);
  const returnPercent=returnBasis.gt(0)?totalPnl.div(returnBasis).mul(100):null;

  const interval=15*60_000;
  const snapshotBucket=new Date(Math.floor(Date.now()/interval)*interval);
  await db.portfolioSnapshot.upsert({where:{userId_accountMode_snapshotBucket:{userId:user.id,accountMode:mode,snapshotBucket}},create:{userId:user.id,accountMode:mode,snapshotBucket,cashBalance,positionValue,investmentValue,totalValue,realizedPnl,unrealizedPnl},update:{cashBalance,positionValue,investmentValue,totalValue,realizedPnl,unrealizedPnl}});
  const performance=await db.portfolioSnapshot.findMany({where:{userId:user.id,accountMode:mode},orderBy:{snapshotBucket:'desc'},take:5000});
  const dayStart=new Date();dayStart.setUTCHours(0,0,0,0);
  const todaySnapshots=performance.filter(snapshot=>snapshot.snapshotBucket>=dayStart).toReversed();
  const dailyPnl=todaySnapshots.length>1?totalValue.minus(todaySnapshots[0].totalValue):null;
  const dailyPercent=dailyPnl&&todaySnapshots[0].totalValue.gt(0)?dailyPnl.div(todaySnapshots[0].totalValue).mul(100):null;
  const holdings=[
   ...valuedPositions.map(position=>({
    id:`POSITION:${position.id}`,
    name:position.instrument.name,
    category:instrumentAssetCategory(position.instrument),
    invested:position.entryPrice.mul(position.quantity),
    value:position.marketValue??zero(),
    gainLoss:position.unrealizedPnl??zero(),
    status:position.status,
   })),
   ...investedRequests.map(item=>({
    id:`INVESTMENT:${item.id}`,
    name:item.opportunity.title,
    category:item.opportunity.category,
    invested:item.amount,
    value:item.amount,
    gainLoss:zero(),
    status:item.status,
   })),
  ];
  const allocationValues=new Map<string,Prisma.Decimal>();
  for(const holding of holdings)allocationValues.set(holding.category,(allocationValues.get(holding.category)??zero()).plus(holding.value));
  const allocations=calculateAllocationPercentages([...allocationValues].map(([category,value])=>({category,value})));
  const rankedPositions=valuedPositions.filter(position=>position.unrealizedPnl!==null).toSorted((left,right)=>Number(right.unrealizedPnl)-Number(left.unrealizedPnl));
  const response={accountMode:mode,currency:'USD',cashBalance,positionValue,investmentValue,totalValue,realizedPnl,unrealizedPnl,totalPnl,returnPercent,dailyPnl,dailyPercent,positions:valuedPositions,investments,holdings,totalInvested:holdings.reduce((sum,item)=>sum.plus(item.invested),zero()),totalCurrentValue:positionValue.plus(investmentValue),allocations,topGainers:rankedPositions.slice(0,3),topLosers:rankedPositions.slice(-3).reverse(),performance:performance.toReversed(),marketDataMode:'SIMULATED',externalValuationAvailable:false};
  return NextResponse.json(jsonSafe(response),{headers:{'Cache-Control':'private, no-store'}});
 }catch(error){
  return NextResponse.json({error:error instanceof Error&&error.message==='UNAUTHORIZED'?'Unauthorized':'Portfolio data is temporarily unavailable.'},{status:error instanceof Error&&error.message==='UNAUTHORIZED'?401:503,headers:{'Cache-Control':'private, no-store'}});
 }
}
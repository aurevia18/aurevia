import {AccountMode,EntryType,NotificationType,OrderSide,PositionStatus,Prisma} from '@prisma/client';
import {createNotification} from '@/lib/notifications';
import {balance,ensureSystemAccount,ensureUserLedger,roundUsdAmount} from '@/lib/ledger';
import {assertFreshQuote,assertSellableQuantity,realizedSpotPnl} from '@/lib/trading-policy';

const Decimal=Prisma.Decimal;
const quotePrecision=10;

export function calculateSimulatedBitcoinConversion(direction:'BUY'|'SELL',amount:Prisma.Decimal,price:Prisma.Decimal,feeRate:Prisma.Decimal){
 if(amount.lte(0)||price.lte(0)||feeRate.lt(0)||feeRate.gte(1))throw new Error('INVALID_CONVERSION');
 const usdAmount=direction==='BUY'?roundUsdAmount(amount):amount;
 const feeBase=direction==='BUY'?usdAmount:roundUsdAmount(amount.mul(price));
 const fee=roundUsdAmount(feeBase.mul(feeRate));
 const grossUsd=direction==='BUY'?usdAmount.minus(fee):feeBase;
 const bitcoinAmount=(direction==='BUY'?grossUsd.div(price):amount).toDecimalPlaces(quotePrecision,Prisma.Decimal.ROUND_DOWN);
 const netUsd=direction==='BUY'?usdAmount:grossUsd.minus(fee);
 if(bitcoinAmount.lte(0)||netUsd.lte(0))throw new Error('INVALID_CONVERSION');
 return {bitcoinAmount,fee,netUsd,grossUsd,executionPrice:price};
}

export async function convertSimulatedBitcoinTx(tx:Prisma.TransactionClient,args:{userId:string;direction:'BUY'|'SELL';amount:Prisma.Decimal;idempotencyKey:string}){
 const reference=`DEMO:BTC:CONVERSION:${args.userId}:${args.idempotencyKey}`;
 const prior=await tx.ledgerTransaction.findUnique({where:{reference},select:{id:true,description:true,createdAt:true}});
 const prefix=`SIMULATED BTC ${args.direction} amount=${args.amount.toString()};`;
 if(prior){
  if(!prior.description.startsWith(prefix))throw new Error('IDEMPOTENCY_KEY_REUSED');
  return {reference,replayed:true,transactionId:prior.id};
 }
 const instrument=await tx.instrument.findUnique({where:{symbol:'BTC/USD'}});
 if(!instrument?.enabled)throw new Error('BITCOIN_INSTRUMENT_UNAVAILABLE');
 assertFreshQuote(instrument.updatedAt);
 const price=new Decimal(instrument.price);
 const tradeAmount=args.direction==='BUY'?roundUsdAmount(args.amount):args.amount;
 const conversion=calculateSimulatedBitcoinConversion(args.direction,tradeAmount,price,new Decimal(instrument.takerFee));
 const cash=await ensureUserLedger(tx,args.userId,AccountMode.DEMO,'USD');
 const bitcoin=await ensureUserLedger(tx,args.userId,AccountMode.DEMO,'BTC');
 const usdClearing=await ensureSystemAccount(tx,'SYSTEM:DEMO:BTC_CONVERSION:USD','Simulated Bitcoin conversion clearing','USD',AccountMode.DEMO);
 const btcClearing=await ensureSystemAccount(tx,'SYSTEM:DEMO:BTC_CONVERSION:BTC','Simulated Bitcoin conversion inventory','BTC',AccountMode.DEMO);
 const feeAccount=await ensureSystemAccount(tx,'SYSTEM:DEMO:BTC_CONVERSION_FEES:USD','Simulated Bitcoin conversion fees','USD',AccountMode.DEMO);
 const dust=args.direction==='BUY'?conversion.grossUsd.minus(conversion.bitcoinAmount.mul(price)):new Decimal(0);
 const roundingAccount=dust.gt(0)?await ensureSystemAccount(tx,'SYSTEM:DEMO:BTC_CONVERSION_ROUNDING:USD','Simulated Bitcoin conversion rounding','USD',AccountMode.DEMO):null;
 const entries:Prisma.LedgerEntryCreateWithoutTransactionInput[]=[];
 let pnl:Prisma.Decimal|null=null;
 if(args.direction==='BUY'){
  if((await balance(tx,cash.id)).lt(tradeAmount))throw new Error('INSUFFICIENT_DEMO_BALANCE');
  const existing=await tx.position.findFirst({where:{userId:args.userId,instrumentId:instrument.id,accountMode:AccountMode.DEMO,status:PositionStatus.OPEN,side:OrderSide.BUY}});
  const totalQuantity=(existing?.quantity??new Decimal(0)).plus(conversion.bitcoinAmount);
  const totalBasis=(existing?.margin??new Decimal(0)).plus(tradeAmount);
  const average=totalBasis.div(totalQuantity).toDecimalPlaces(quotePrecision);
  if(existing){
   const changed=await tx.position.updateMany({where:{id:existing.id,status:PositionStatus.OPEN,quantity:existing.quantity},data:{quantity:totalQuantity,entryPrice:average,margin:totalBasis}});
   if(changed.count!==1)throw new Error('POSITION_CHANGED');
  }else{
   await tx.position.create({data:{userId:args.userId,instrumentId:instrument.id,accountMode:AccountMode.DEMO,side:OrderSide.BUY,quantity:conversion.bitcoinAmount,entryPrice:average,margin:tradeAmount}});
  }
  entries.push({account:{connect:{id:cash.id}},type:EntryType.DEBIT,amount:tradeAmount},{account:{connect:{id:usdClearing.id}},type:EntryType.CREDIT,amount:conversion.grossUsd.minus(dust)},{account:{connect:{id:feeAccount.id}},type:EntryType.CREDIT,amount:conversion.fee},{account:{connect:{id:bitcoin.id}},type:EntryType.CREDIT,amount:conversion.bitcoinAmount},{account:{connect:{id:btcClearing.id}},type:EntryType.DEBIT,amount:conversion.bitcoinAmount});
  if(roundingAccount&&dust.gt(0))entries.splice(1,0,{account:{connect:{id:roundingAccount.id}},type:EntryType.CREDIT,amount:dust});
 }else{
  const position=await tx.position.findFirst({where:{userId:args.userId,instrumentId:instrument.id,accountMode:AccountMode.DEMO,status:PositionStatus.OPEN,side:OrderSide.BUY}});
  const reserved=await tx.order.aggregate({where:{userId:args.userId,instrumentId:instrument.id,accountMode:AccountMode.DEMO,side:OrderSide.SELL,status:'OPEN'},_sum:{quantity:true}});
  assertSellableQuantity(position?.quantity??new Decimal(0),reserved._sum.quantity??new Decimal(0),conversion.bitcoinAmount);
  if(!position)throw new Error('INSUFFICIENT_POSITION');
  const changed=await tx.position.updateMany({where:{id:position.id,status:PositionStatus.OPEN,quantity:position.quantity},data:position.quantity.eq(conversion.bitcoinAmount)?{status:PositionStatus.CLOSED,closedAt:new Date(),quantity:0,margin:0}:{quantity:{decrement:conversion.bitcoinAmount},margin:position.margin.mul(position.quantity.minus(conversion.bitcoinAmount)).div(position.quantity)}});
  if(changed.count!==1)throw new Error('POSITION_CHANGED');
  pnl=realizedSpotPnl(position.entryPrice,price,conversion.bitcoinAmount,conversion.fee);
  await tx.position.update({where:{id:position.id},data:{realizedPnl:{increment:pnl}}});
  entries.push({account:{connect:{id:usdClearing.id}},type:EntryType.DEBIT,amount:conversion.grossUsd},{account:{connect:{id:cash.id}},type:EntryType.CREDIT,amount:conversion.netUsd},{account:{connect:{id:feeAccount.id}},type:EntryType.CREDIT,amount:conversion.fee},{account:{connect:{id:bitcoin.id}},type:EntryType.DEBIT,amount:conversion.bitcoinAmount},{account:{connect:{id:btcClearing.id}},type:EntryType.CREDIT,amount:conversion.bitcoinAmount});
 }
 const postedEntries=entries.filter(entry=>new Decimal(entry.amount.toString()).gt(0));
 const description=`${prefix} USD=${args.direction==='BUY'?conversion.netUsd.plus(conversion.fee).toString():conversion.netUsd.toString()}; BTC=${conversion.bitcoinAmount.toString()}; price=${price.toString()}; fee=${conversion.fee.toString()};`;
 const transaction=await tx.ledgerTransaction.create({data:{reference,description,accountMode:AccountMode.DEMO,entries:{create:postedEntries.map(entry=>({...entry,accountMode:AccountMode.DEMO}))}}});
 await tx.auditLog.create({data:{actorId:args.userId,action:`DEMO_BTC_${args.direction}`,entity:'LEDGER_TRANSACTION',entityId:transaction.id,metadata:{accountMode:AccountMode.DEMO,simulated:true,reference,direction:args.direction,usdAmount:(args.direction==='BUY'?tradeAmount:conversion.netUsd).toString(),bitcoinAmount:conversion.bitcoinAmount.toString(),executionPrice:price.toString(),fee:conversion.fee.toString(),realizedPnl:pnl?.toString()??null}}});
 await createNotification(tx,{userId:args.userId,type:NotificationType.TRADE,title:`Simulated BTC ${args.direction==='BUY'?'purchase':'sale'} complete`,message:`SIMULATED: ${args.direction==='BUY'?'Converted '+tradeAmount.toFixed(2)+' USD to '+conversion.bitcoinAmount.toString()+' BTC':'Sold '+conversion.bitcoinAmount.toString()+' BTC for '+conversion.netUsd.toFixed(2)+' USD'} at ${price.toString()} USD/BTC. Fee: ${conversion.fee.toFixed(2)} USD. Reference: ${reference}. No cryptocurrency was sent to a blockchain.`,dedupeKey:`btc-conversion:${args.userId}:${args.idempotencyKey}`,relatedEntity:'LEDGER_TRANSACTION',relatedId:transaction.id,actionUrl:'/activity'});
 return {reference,replayed:false,transactionId:transaction.id,usdAmount:(args.direction==='BUY'?tradeAmount:conversion.netUsd),bitcoinAmount:conversion.bitcoinAmount,executionPrice:price,fee:conversion.fee};
}

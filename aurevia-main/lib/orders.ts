import {randomUUID} from 'node:crypto';
import {db} from './db';
import {balance,ensureSystemAccount,ensureUserLedger,postDoubleEntry,roundUsdAmount} from './ledger';
import {AccountMode,NotificationType,OrderSide,OrderStatus,OrderType,Prisma} from '@prisma/client';
import {createNotification} from '@/lib/notifications';
import {assertFreshQuote,assertSellableQuantity,averageEntryPrice,realizedSpotPnl} from '@/lib/trading-policy';

export type PlaceOrderInput={instrumentId:string;side:OrderSide;type:OrderType;quantity:number;price?:number;stopPrice?:number;expectedPrice:number;observedAt:string};

function executable(type:OrderType,side:OrderSide,market:number,price?:number,stopPrice?:number){
 if(type===OrderType.MARKET)return true;
 if(type===OrderType.LIMIT)return price!==undefined&&(side===OrderSide.BUY?market<=price:market>=price);
 return stopPrice!==undefined&&(side===OrderSide.BUY?market>=stopPrice:market<=stopPrice);
}

export function matchesOrder(order:Awaited<ReturnType<typeof db.order.findUnique>>|null,userId:string,accountMode:AccountMode,input:PlaceOrderInput){
 return !!order&&order.userId===userId&&order.accountMode===accountMode&&order.instrumentId===input.instrumentId&&order.side===input.side&&order.type===input.type&&order.quantity.equals(input.quantity)&&((order.price===null&&input.price===undefined)||(!!order.price&&order.price.equals(input.price||0)))&&((order.stopPrice===null&&input.stopPrice===undefined)||(!!order.stopPrice&&order.stopPrice.equals(input.stopPrice||0)));
}

export async function executeOrderTx(tx:Prisma.TransactionClient,orderId:string,fill:number){
 const order=await tx.order.findUnique({where:{id:orderId},include:{instrument:true}});
 if(!order||order.status!==OrderStatus.OPEN)throw new Error('ORDER_NOT_OPEN');
 const quantity=order.quantity.minus(order.filledQuantity); if(quantity.lte(0))throw new Error('ORDER_FILLED');
 const fillPrice=new Prisma.Decimal(fill);
 if(fillPrice.lte(0))throw new Error('INVALID_PRICE');
 const notional=roundUsdAmount(fillPrice.mul(quantity));
 const fee=roundUsdAmount(notional.mul(order.instrument.takerFee));
 const userAcct=await ensureUserLedger(tx,order.userId,order.accountMode);
 const fees=await ensureSystemAccount(tx,`SYSTEM:${order.accountMode}:FEES`,'Simulated trading fees','USD',order.accountMode);
 const clearing=await ensureSystemAccount(tx,`SYSTEM:${order.accountMode}:CLEARING`,'Simulated spot clearing','USD',order.accountMode);
 const existing=await tx.position.findFirst({where:{userId:order.userId,instrumentId:order.instrumentId,accountMode:order.accountMode,status:'OPEN',side:OrderSide.BUY}});
 if(order.side===OrderSide.BUY){
  const [ledgerBalance,pendingWithdrawals]=await Promise.all([
   balance(tx,userAcct.id),
   tx.fundingRequest.aggregate({where:{userId:order.userId,accountMode:order.accountMode,currency:userAcct.currency,type:'WITHDRAWAL',status:{in:['PENDING','PENDING_REVIEW','APPROVED','PROCESSING']}},_sum:{amount:true}}),
  ]);
  const available=ledgerBalance.minus(pendingWithdrawals._sum.amount??new Prisma.Decimal(0));
  if(available.lt(notional.plus(fee)))throw new Error('INSUFFICIENT_SIMULATED_BALANCE');
  await postDoubleEntry(tx,{reference:`TRADE:BUY:${order.id}`,description:`Simulated purchase of ${order.instrument.symbol}`,debitAccountId:userAcct.id,creditAccountId:clearing.id,amount:notional});
  if(fee.gt(0))await postDoubleEntry(tx,{reference:`TRADE:FEE:${order.id}`,description:`Simulated ${order.instrument.symbol} trading fee`,debitAccountId:userAcct.id,creditAccountId:fees.id,amount:fee});
  if(existing){
   const average=averageEntryPrice(existing.quantity,existing.entryPrice,quantity,fillPrice,fee);
   await tx.position.update({where:{id:existing.id},data:{quantity:{increment:quantity},entryPrice:average,margin:{increment:notional.plus(fee)},leverage:1}});
  }else{
   const entry=averageEntryPrice(new Prisma.Decimal(0),new Prisma.Decimal(0),quantity,fillPrice,fee);
   await tx.position.create({data:{userId:order.userId,instrumentId:order.instrumentId,accountMode:order.accountMode,side:OrderSide.BUY,quantity,entryPrice:entry,leverage:1,margin:notional.plus(fee)}});
  }
 }else{
  if(!existing)throw new Error('INSUFFICIENT_POSITION');
  const reserved=await tx.order.aggregate({where:{userId:order.userId,instrumentId:order.instrumentId,accountMode:order.accountMode,side:OrderSide.SELL,status:OrderStatus.OPEN,id:{not:order.id}},_sum:{quantity:true}});
  assertSellableQuantity(existing.quantity,reserved._sum.quantity??new Prisma.Decimal(0),quantity);
  const pnl=realizedSpotPnl(existing.entryPrice,fillPrice,quantity,fee);
  await postDoubleEntry(tx,{reference:`TRADE:SELL:${order.id}`,description:`Simulated sale of ${order.instrument.symbol}`,debitAccountId:clearing.id,creditAccountId:userAcct.id,amount:notional});
  if(fee.gt(0))await postDoubleEntry(tx,{reference:`TRADE:FEE:${order.id}`,description:`Simulated ${order.instrument.symbol} trading fee`,debitAccountId:userAcct.id,creditAccountId:fees.id,amount:fee});
  const remaining=existing.quantity.minus(quantity);
  const basisReduction=existing.margin.mul(quantity).div(existing.quantity);
  await tx.position.update({where:{id:existing.id},data:remaining.isZero()?{status:'CLOSED',closedAt:new Date(),margin:0,realizedPnl:{increment:pnl}}:{quantity:remaining,margin:existing.margin.minus(basisReduction),realizedPnl:{increment:pnl}}});
 }
 await tx.execution.create({data:{orderId:order.id,accountMode:order.accountMode,quantity,price:fillPrice,fee}});
 await tx.order.update({where:{id:order.id},data:{filledQuantity:{increment:quantity},averageFillPrice:fillPrice,fee:{increment:fee},status:OrderStatus.FILLED}});
 await tx.auditLog.create({data:{actorId:order.userId,action:`${order.accountMode==='DEMO'?'DEMO':'REAL_SIMULATED'}_ORDER_${order.side}_FILLED`,entity:'ORDER',entityId:order.id,metadata:{oldState:OrderStatus.OPEN,newState:OrderStatus.FILLED,accountMode:order.accountMode,simulated:true,instrument:order.instrument.symbol,quantity:quantity.toString(),fillPrice:fillPrice.toString(),fee:fee.toString()}}});
 await createNotification(tx,{userId:order.userId,type:NotificationType.TRADE,title:`${order.accountMode} simulated order filled`,message:`Your ${order.side.toLowerCase()} order for ${order.instrument.symbol} filled ${quantity.toString()} at ${fillPrice.toString()} using simulated trading. No external order was placed.`,dedupeKey:`order:${order.id}:filled`,relatedEntity:'ORDER',relatedId:order.id,actionUrl:'/trade'});
 return tx.order.findUnique({where:{id:order.id},include:{executions:true,instrument:true}});
}

export async function closeSimulatedPositionTx(tx:Prisma.TransactionClient,userId:string,positionId:string,actorId=userId,accountMode?:AccountMode){
 const position=await tx.position.findFirst({where:{id:positionId,userId,status:'OPEN',...(accountMode?{accountMode}:{})},include:{instrument:true}});
 if(!position)throw new Error('POSITION_NOT_FOUND');
 const price=position.instrument.price;
 if(price.lte(0))throw new Error('INVALID_PRICE');
 const userAccount=await ensureUserLedger(tx,userId,position.accountMode);
 let pnl:Prisma.Decimal;
 let fee=new Prisma.Decimal(0);
 if(position.side===OrderSide.BUY){
  const quantity=position.quantity;
  const proceeds=roundUsdAmount(price.mul(quantity));
  fee=roundUsdAmount(proceeds.mul(position.instrument.takerFee));
  const clearing=await ensureSystemAccount(tx,`SYSTEM:${position.accountMode}:CLEARING`,'Simulated spot clearing','USD',position.accountMode);
  const fees=await ensureSystemAccount(tx,`SYSTEM:${position.accountMode}:FEES`,'Simulated trading fees','USD',position.accountMode);
  await postDoubleEntry(tx,{reference:`${position.accountMode}:POSITION_CLOSE:${position.id}`,description:`Simulated sale of ${position.instrument.symbol}`,debitAccountId:clearing.id,creditAccountId:userAccount.id,amount:proceeds});
  if(fee.gt(0))await postDoubleEntry(tx,{reference:`${position.accountMode}:POSITION_CLOSE_FEE:${position.id}`,description:`Simulated ${position.instrument.symbol} closing fee`,debitAccountId:userAccount.id,creditAccountId:fees.id,amount:fee});
  pnl=realizedSpotPnl(position.entryPrice,price,quantity,fee);
 }else{
  const clearing=await ensureSystemAccount(tx,`SYSTEM:${position.accountMode}:CLEARING`,'Simulated clearing','USD',position.accountMode);
  pnl=position.entryPrice.minus(price).mul(position.quantity);
  const settlement=position.margin.plus(pnl);
  if(settlement.lte(0))throw new Error('POSITION_LIQUIDATED');
  await postDoubleEntry(tx,{reference:`${position.accountMode}:LEGACY_POSITION_CLOSE:${position.id}`,description:'Simulated legacy position close',debitAccountId:clearing.id,creditAccountId:userAccount.id,amount:settlement});
 }
 const closingOrder=await tx.order.create({data:{
  userId,
  instrumentId:position.instrumentId,
  accountMode:position.accountMode,
  side:position.side===OrderSide.BUY?OrderSide.SELL:OrderSide.BUY,
  type:OrderType.MARKET,
  status:OrderStatus.FILLED,
  quantity:position.quantity,
  filledQuantity:position.quantity,
  averageFillPrice:price,
  fee,
  idempotencyKey:`POSITION_CLOSE:${position.id}:${randomUUID()}`,
 }});
 await tx.execution.create({data:{orderId:closingOrder.id,accountMode:position.accountMode,quantity:position.quantity,price,fee}});
 const closed=await tx.position.update({where:{id:position.id},data:{status:'CLOSED',closedAt:new Date(),margin:0,realizedPnl:{increment:pnl}}});
 await tx.auditLog.create({data:{actorId,action:`${position.accountMode}_SIMULATED_POSITION_${actorId===userId?'CLOSED':'ADMIN_CLOSED'}`,entity:'POSITION',entityId:position.id,metadata:{accountMode:position.accountMode,simulated:true,symbol:position.instrument.symbol,quantity:position.quantity.toString(),exitPrice:price.toString(),realizedPnl:pnl.toString(),closingOrderId:closingOrder.id}}});
 await tx.auditLog.create({data:{actorId,action:`${position.accountMode==='DEMO'?'DEMO':'REAL_SIMULATED'}_ORDER_${closingOrder.side}_FILLED`,entity:'ORDER',entityId:closingOrder.id,metadata:{oldState:OrderStatus.OPEN,newState:OrderStatus.FILLED,accountMode:position.accountMode,simulated:true,positionId:position.id,instrument:position.instrument.symbol,quantity:position.quantity.toString(),fillPrice:price.toString(),fee:fee.toString()}}});
 await createNotification(tx,{userId,type:NotificationType.TRADE,title:`${position.accountMode} simulated position closed`,message:`Your ${position.instrument.symbol} position was closed by a simulated ${closingOrder.side.toLowerCase()} order. No external order was placed.`,dedupeKey:`order:${closingOrder.id}:filled`,relatedEntity:'ORDER',relatedId:closingOrder.id,actionUrl:'/trade'});
 return closed;
}

export async function placeOrder(userId:string,accountMode:AccountMode,input:PlaceOrderInput,idempotencyKey:string){
 if(!Number.isFinite(input.quantity)||input.quantity<=0||input.quantity>1_000_000_000)throw new Error('INVALID_QUANTITY');
 if(!Number.isFinite(input.expectedPrice)||input.expectedPrice<=0)throw new Error('INVALID_PRICE');
 assertFreshQuote(input.observedAt);
 if(input.type===OrderType.LIMIT&&(!Number.isFinite(input.price)||Number(input.price)<=0))throw new Error('LIMIT_PRICE_REQUIRED');
 if(input.type===OrderType.STOP&&(!Number.isFinite(input.stopPrice)||Number(input.stopPrice)<=0))throw new Error('STOP_PRICE_REQUIRED');
 const create=()=>db.$transaction(async tx=>{
   const activeUser=await tx.user.findUnique({where:{id:userId},select:{accountMode:true,status:true,role:true}});
   if(!activeUser||activeUser.status!=='ACTIVE'||activeUser.role!=='USER')throw new Error('ORDER_ACCOUNT_UNAVAILABLE');
   if(activeUser.accountMode!==accountMode)throw new Error('ACCOUNT_MODE_CHANGED');
   const prior=await tx.order.findUnique({where:{idempotencyKey},include:{executions:true,instrument:true}});
   if(prior){if(!matchesOrder(prior,userId,accountMode,input))throw new Error('IDEMPOTENCY_KEY_REUSED');return prior;}
   const inst=await tx.instrument.findUnique({where:{id:input.instrumentId}}); if(!inst||!inst.enabled)throw new Error('INSTRUMENT_UNAVAILABLE');
   if(inst.updatedAt.getTime()>Date.now()+5_000)throw new Error('STALE_MARKET_QUOTE');
   const market=Number(inst.price); const price=input.price===undefined?undefined:Number(input.price); const stop=input.stopPrice===undefined?undefined:Number(input.stopPrice);
   if(input.side===OrderSide.SELL){
    const position=await tx.position.findFirst({where:{userId,instrumentId:inst.id,accountMode,status:'OPEN',side:OrderSide.BUY}});
    const reservations=await tx.order.aggregate({where:{userId,instrumentId:inst.id,accountMode,side:OrderSide.SELL,status:OrderStatus.OPEN},_sum:{quantity:true}});
    assertSellableQuantity(position?.quantity??new Prisma.Decimal(0),reservations._sum.quantity??new Prisma.Decimal(0),new Prisma.Decimal(input.quantity));
   }
  const order=await tx.order.create({data:{userId,instrumentId:inst.id,accountMode,side:input.side,type:input.type,quantity:input.quantity,price,stopPrice:stop,idempotencyKey,status:OrderStatus.OPEN}});
  await tx.auditLog.create({data:{actorId:userId,action:`${accountMode}_SIMULATED_ORDER_SUBMITTED`,entity:'ORDER',entityId:order.id,metadata:{newState:OrderStatus.OPEN,accountMode,simulated:true,instrumentId:inst.id,side:input.side,type:input.type,quantity:order.quantity.toString(),expectedPrice:input.expectedPrice,observedAt:input.observedAt}}});
  await createNotification(tx,{userId,type:NotificationType.TRADE,title:`${accountMode} simulated order submitted`,message:`Your ${input.side.toLowerCase()} ${input.type.toLowerCase()} order for ${inst.symbol} was submitted using simulated execution. No external order was placed.`,dedupeKey:`order:${order.id}:submitted`,relatedEntity:'ORDER',relatedId:order.id,actionUrl:'/trade'});
   if(!executable(input.type,input.side,market,price,stop))return order;
   return executeOrderTx(tx,order.id,market);
 },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,maxWait:5_000,timeout:15_000});
 try{return await create();}
 catch(error){
  if(error&&typeof error==='object'&&'code'in error&&['P2002','P2034'].includes(String(error.code))){
   const existing=await db.order.findUnique({where:{idempotencyKey},include:{executions:true,instrument:true}});
   if(existing&&matchesOrder(existing,userId,accountMode,input))return existing;
   if(existing)throw new Error('IDEMPOTENCY_KEY_REUSED');
  }
  throw error;
 }
}

export async function processOpenOrders(){
 const orders=await db.order.findMany({where:{status:OrderStatus.OPEN,accountMode:{in:[AccountMode.DEMO,AccountMode.REAL]}},include:{instrument:true},take:500,orderBy:{createdAt:'asc'}});
 for(const o of orders){
   const p=Number(o.instrument.price); const hit=executable(o.type,o.side,p,o.price===null?undefined:Number(o.price),o.stopPrice===null?undefined:Number(o.stopPrice));
   if(!hit)continue;
  try{await db.$transaction(tx=>executeOrderTx(tx,o.id,p),{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,maxWait:5_000,timeout:15_000});}
  catch(e){if(e instanceof Error&&['INSUFFICIENT_SIMULATED_BALANCE','INSUFFICIENT_POSITION','ORDER_NOT_OPEN','ORDER_FILLED'].includes(e.message))await db.$transaction(async tx=>{const rejected=await tx.order.updateMany({where:{id:o.id,status:OrderStatus.OPEN},data:{status:OrderStatus.REJECTED}});if(rejected.count){await tx.auditLog.create({data:{actorId:o.userId,action:`${o.accountMode}_SIMULATED_ORDER_REJECTED`,entity:'ORDER',entityId:o.id,metadata:{oldState:OrderStatus.OPEN,newState:OrderStatus.REJECTED,accountMode:o.accountMode,simulated:true,reason:e.message}}});await createNotification(tx,{userId:o.userId,type:NotificationType.TRADE,title:`${o.accountMode} simulated order rejected`,message:`Your ${o.side.toLowerCase()} order for ${o.instrument.symbol} was rejected in the simulated account.`,dedupeKey:`order:${o.id}:rejected`,relatedEntity:'ORDER',relatedId:o.id,actionUrl:'/trade'});}});}
 }
}

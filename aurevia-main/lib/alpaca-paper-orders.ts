import {AccountMode,NotificationType,OrderSide,OrderStatus,OrderType,Prisma} from '@prisma/client';
import {createNotification} from '@/lib/notifications';
import {db} from '@/lib/db';
import {balance,ensureUserLedger,reservedWithdrawalAmount} from '@/lib/ledger';
import {assertFreshQuote,assertSellableQuantity} from '@/lib/trading-policy';
import {assertPaperBuyCollateral,paperOrderCollateral} from '@/lib/bitcoin-funding';
import {AlpacaTradingApiError,createIndividualTradingApiProviderFromEnvironment} from '@/lib/providers/alpaca-crypto-provider';
import type {ProviderOrder} from '@/lib/providers/contracts';
import {matchesOrder,type PlaceOrderInput} from '@/lib/orders';
import {getServerConfiguration} from '@/lib/config/env';

export const ALPACA_PAPER_PROVIDER='alpaca-paper';

export class AlpacaPaperOrderError extends Error{
	constructor(readonly code:string,readonly httpStatus=409){super(code);this.name='AlpacaPaperOrderError'}
}

function localStatus(order:ProviderOrder):OrderStatus{
	switch(order.state){
		case 'ACCEPTED':return OrderStatus.OPEN;
		case 'PARTIALLY_FILLED':return OrderStatus.PARTIALLY_FILLED;
		case 'FILLED':return OrderStatus.FILLED;
		case 'CANCELLED':return OrderStatus.CANCELLED;
		case 'REJECTED':
		case 'FAILED':return OrderStatus.REJECTED;
	}
}

function timestamp(value:string){
	const date=new Date(value);
	if(!Number.isFinite(date.getTime()))throw new AlpacaPaperOrderError('ALPACA_PAPER_INVALID_ORDER_TIMESTAMP',502);
	return date;
}

function validatePaperResponse(order:ProviderOrder,requestedQuantity:Prisma.Decimal){
	if(!order.providerOrderId||!order.providerStatus||!order.clientOrderId)throw new AlpacaPaperOrderError('ALPACA_PAPER_INVALID_ORDER_RESPONSE',502);
	const filled=new Prisma.Decimal(order.filledQuantity??'0');
	if(!filled.isFinite()||filled.isNegative()||filled.gt(requestedQuantity))throw new AlpacaPaperOrderError('ALPACA_PAPER_INVALID_ORDER_RESPONSE',502);
	if(order.state==='FILLED'&&!filled.equals(requestedQuantity)||order.state==='PARTIALLY_FILLED'&&(filled.isZero()||filled.gte(requestedQuantity)))throw new AlpacaPaperOrderError('ALPACA_PAPER_INVALID_ORDER_RESPONSE',502);
	if(order.averageFillPrice!==undefined){
		const price=new Prisma.Decimal(order.averageFillPrice);
		if(!price.isFinite()||!price.gt(0))throw new AlpacaPaperOrderError('ALPACA_PAPER_INVALID_ORDER_RESPONSE',502);
	}
	if(filled.gt(0)&&!order.averageFillPrice)throw new AlpacaPaperOrderError('ALPACA_PAPER_INVALID_ORDER_RESPONSE',502);
	return {filled,providerStatus:order.providerStatus,acceptedAt:timestamp(order.acceptedAt),updatedAt:timestamp(order.updatedAt)};
}

async function persistProviderOrder(orderId:string,response:ProviderOrder,accountId:string,actorId:string){
	return db.$transaction(async tx=>{
		const current=await tx.order.findUnique({where:{id:orderId},include:{executions:true,instrument:true}});
		if(!current||current.providerName!==ALPACA_PAPER_PROVIDER||current.accountMode!==AccountMode.REAL)throw new AlpacaPaperOrderError('ALPACA_PAPER_ORDER_NOT_FOUND',404);
		if(current.providerOrderId&&current.providerOrderId!==response.providerOrderId)throw new AlpacaPaperOrderError('ALPACA_PAPER_ORDER_ID_MISMATCH',409);
		if(response.clientOrderId!==current.idempotencyKey)throw new AlpacaPaperOrderError('ALPACA_PAPER_CLIENT_ORDER_ID_MISMATCH',502);
		const validated=validatePaperResponse(response,current.quantity);
		const nextStatus=localStatus(response);
		const changed=current.providerOrderId!==response.providerOrderId||
			current.providerStatus!==validated.providerStatus||
			!current.filledQuantity.equals(validated.filled)||
			current.averageFillPrice?.toString()!==(response.averageFillPrice??null);
		if(!changed)return current;
		const updated=await tx.order.update({where:{id:current.id},data:{
			providerAccountId:accountId,
			providerOrderId:response.providerOrderId,
			providerStatus:validated.providerStatus,
			providerAcceptedAt:validated.acceptedAt,
			providerUpdatedAt:validated.updatedAt,
			status:nextStatus,
			filledQuantity:validated.filled,
			averageFillPrice:response.averageFillPrice===undefined?null:new Prisma.Decimal(response.averageFillPrice),
			reconciliationStatus:'CONFIRMED_BY_ALPACA_PAPER',
			reconciledAt:new Date(),
		},include:{executions:true,instrument:true}});
		await tx.auditLog.create({data:{actorId,action:'REAL_PAPER_ORDER_PROVIDER_UPDATED',entity:'ORDER',entityId:current.id,metadata:{
			oldState:current.providerStatus??'SUBMISSION_PENDING',
			newState:validated.providerStatus,
			accountMode:AccountMode.REAL,
			simulated:true,
			provider:ALPACA_PAPER_PROVIDER,
			providerAccountId:accountId,
			providerOrderId:response.providerOrderId,
			filledQuantity:validated.filled.toString(),
			averageFillPrice:response.averageFillPrice??null,
		}}});
		await createNotification(tx,{userId:current.userId,type:NotificationType.TRADE,title:`REAL · Alpaca Paper order ${validated.providerStatus.replaceAll('_',' ')}`,message:`Your ${current.side.toLowerCase()} ${current.instrument.symbol} order updated in the shared Alpaca Paper account. Paper activity does not change your Aurevia REAL balance or positions.`,dedupeKey:`paper-order:${current.id}:${validated.providerStatus}:${validated.filled.toString()}`,relatedEntity:'ORDER',relatedId:current.id,actionUrl:'/orders'});
		return updated;
	},{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,maxWait:5_000,timeout:15_000});
}

async function persistSubmissionFailure(orderId:string,actorId:string,providerStatus:string,status:OrderStatus){
	return db.$transaction(async tx=>{
		const current=await tx.order.findUnique({where:{id:orderId},include:{executions:true,instrument:true}});
		if(!current||current.providerName!==ALPACA_PAPER_PROVIDER)throw new AlpacaPaperOrderError('ALPACA_PAPER_ORDER_NOT_FOUND',404);
		const updated=await tx.order.update({where:{id:orderId},data:{status,providerStatus,providerUpdatedAt:new Date(),reconciliationStatus:'PROVIDER_ERROR'},include:{executions:true,instrument:true}});
		await tx.auditLog.create({data:{actorId,action:'REAL_PAPER_ORDER_PROVIDER_ERROR',entity:'ORDER',entityId:orderId,metadata:{accountMode:AccountMode.REAL,simulated:true,provider:ALPACA_PAPER_PROVIDER,providerStatus,internalOrderStatus:status}}});
		return updated;
	});
}

function paperPositionAvailable(history:Array<{side:OrderSide;quantity:Prisma.Decimal;filledQuantity:Prisma.Decimal;status:OrderStatus}>){
	let owned=new Prisma.Decimal(0);
	let reserved=new Prisma.Decimal(0);
	for(const order of history){
		if(order.side===OrderSide.BUY)owned=owned.plus(order.filledQuantity);
		else{
			owned=owned.minus(order.filledQuantity);
			if(order.status===OrderStatus.OPEN||order.status===OrderStatus.PARTIALLY_FILLED)reserved=reserved.plus(order.quantity.minus(order.filledQuantity));
		}
	}
	return {owned,reserved};
}

export async function submitAlpacaPaperOrder(userId:string,input:PlaceOrderInput,idempotencyKey:string){
	if(!Number.isFinite(input.quantity)||input.quantity<=0||input.quantity>1_000_000_000)throw new AlpacaPaperOrderError('INVALID_QUANTITY',400);
	if(!Number.isFinite(input.expectedPrice)||input.expectedPrice<=0)throw new AlpacaPaperOrderError('INVALID_PRICE',400);
	try{assertFreshQuote(input.observedAt)}catch{throw new AlpacaPaperOrderError('STALE_MARKET_QUOTE',409)}
	if(input.type===OrderType.LIMIT&&(!Number.isFinite(input.price)||Number(input.price)<=0))throw new AlpacaPaperOrderError('LIMIT_PRICE_REQUIRED',400);
	if(input.type===OrderType.STOP&&(!Number.isFinite(input.stopPrice)||Number(input.stopPrice)<=0))throw new AlpacaPaperOrderError('STOP_PRICE_REQUIRED',400);
	if(!getServerConfiguration().execution.alpacaPaperOrdersEnabled)throw new AlpacaPaperOrderError('ALPACA_PAPER_ORDERS_DISABLED',403);
	const provider=createIndividualTradingApiProviderFromEnvironment();
	if(!provider)throw new AlpacaPaperOrderError('ALPACA_PAPER_NOT_CONFIGURED',503);

	type PaperOrderRecord=Prisma.OrderGetPayload<{include:{executions:true;instrument:true}}>;
	let createResult:{order:PaperOrderRecord;created:boolean};
	try{
		createResult=await db.$transaction(async tx=>{
		const prior=await tx.order.findUnique({where:{idempotencyKey},include:{executions:true,instrument:true}});
		if(prior){
			if(prior.providerName!==ALPACA_PAPER_PROVIDER||!matchesOrder(prior,userId,AccountMode.REAL,input))throw new AlpacaPaperOrderError('IDEMPOTENCY_KEY_REUSED',409);
			return {order:prior,created:false};
		}
		const user=await tx.user.findUnique({where:{id:userId},select:{id:true,accountMode:true,status:true,accountRestricted:true,role:true}});
		if(!user||user.role!=='USER'||user.status!=='ACTIVE'||user.accountMode!==AccountMode.REAL||user.accountRestricted)throw new AlpacaPaperOrderError('REAL_PAPER_ORDER_USER_UNAVAILABLE',403);
		const instrument=await tx.instrument.findUnique({where:{id:input.instrumentId}});
		if(!instrument||!instrument.enabled)throw new AlpacaPaperOrderError('INSTRUMENT_UNAVAILABLE',409);
		if(instrument.updatedAt.getTime()>Date.now()+5_000)throw new AlpacaPaperOrderError('STALE_MARKET_QUOTE',409);
		const history=await tx.order.findMany({
			where:{userId,accountMode:AccountMode.REAL,providerName:ALPACA_PAPER_PROVIDER},
			select:{instrumentId:true,side:true,quantity:true,filledQuantity:true,averageFillPrice:true,providerReservedAmount:true,status:true,createdAt:true,instrument:{select:{takerFee:true}}},
			orderBy:{createdAt:'asc'},
		});
		if(input.side===OrderSide.BUY){
			const collateralHistory=history.map(order=>({...order,takerFee:order.instrument.takerFee}));
			const collateral=paperOrderCollateral(collateralHistory);
			const account=await ensureUserLedger(tx,userId,AccountMode.REAL,'USD');
			const [walletBalance,pendingWithdrawals]=await Promise.all([
				balance(tx,account.id),
				reservedWithdrawalAmount(tx,userId,AccountMode.REAL,'USD'),
			]);
			const reservePrice=new Prisma.Decimal(input.type===OrderType.LIMIT?input.price!:input.type===OrderType.STOP?input.stopPrice!:input.expectedPrice);
			const requestedCollateral=new Prisma.Decimal(input.quantity).mul(reservePrice).mul(new Prisma.Decimal(1).plus(instrument.takerFee));
			try{assertPaperBuyCollateral(walletBalance,pendingWithdrawals,collateral.committed,requestedCollateral)}
			catch{throw new AlpacaPaperOrderError('INSUFFICIENT_REAL_WALLET_COLLATERAL',409)}
		}
		if(input.side===OrderSide.SELL){
			const position=paperPositionAvailable(history.filter(order=>order.instrumentId===instrument.id));
			assertSellableQuantity(position.owned,position.reserved,new Prisma.Decimal(input.quantity));
		}
		const reservePrice=input.type===OrderType.LIMIT?input.price!:input.type===OrderType.STOP?input.stopPrice!:input.expectedPrice;
		const providerReservedAmount=input.side===OrderSide.BUY
			?new Prisma.Decimal(input.quantity).mul(reservePrice).mul(new Prisma.Decimal(1).plus(instrument.takerFee))
			:null;
		const order=await tx.order.create({data:{
			userId,instrumentId:instrument.id,accountMode:AccountMode.REAL,side:input.side,type:input.type,
			quantity:input.quantity,price:input.price,stopPrice:input.stopPrice,idempotencyKey,
			status:OrderStatus.OPEN,providerName:ALPACA_PAPER_PROVIDER,providerStatus:'SUBMISSION_PENDING',providerReservedAmount,
		},include:{executions:true,instrument:true}});
		await tx.auditLog.create({data:{actorId:userId,action:'REAL_PAPER_ORDER_SUBMISSION_STARTED',entity:'ORDER',entityId:order.id,metadata:{
			newState:'SUBMISSION_PENDING',accountMode:AccountMode.REAL,simulated:true,provider:ALPACA_PAPER_PROVIDER,
			instrument:instrument.symbol,side:input.side,type:input.type,quantity:order.quantity.toString(),
			internalWalletReservation:providerReservedAmount?.toString()??null,currency:'USD',
			internalLedgerChanged:false,internalPositionChanged:false,
		}}});
		await createNotification(tx,{userId,type:NotificationType.TRADE,title:'REAL · Alpaca Paper order submitted',message:`Your ${input.side.toLowerCase()} ${instrument.symbol} order is being submitted to the shared Alpaca Paper account. It does not change your Aurevia REAL balance or positions.`,dedupeKey:`paper-order:${order.id}:submission-started`,relatedEntity:'ORDER',relatedId:order.id,actionUrl:'/orders'});
		return {order,created:true};
		},{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,maxWait:5_000,timeout:15_000});
	}catch(error){
		if(error&&typeof error==='object'&&'code'in error&&['P2002','P2034'].includes(String(error.code))){
			const prior=await db.order.findUnique({where:{idempotencyKey},include:{executions:true,instrument:true}});
			if(prior&&prior.providerName===ALPACA_PAPER_PROVIDER&&matchesOrder(prior,userId,AccountMode.REAL,input))return prior;
			if(prior)throw new AlpacaPaperOrderError('IDEMPOTENCY_KEY_REUSED',409);
			throw new AlpacaPaperOrderError('ORDER_REQUEST_CONFLICT',409);
		}
		throw error;
	}

	if(!createResult.created)return createResult.order;
	const order=createResult.order;
	let account;
	let asset;
	try{
		account=await provider.getAccount();
		if(account.status!=='ACTIVE'||account.account_blocked||account.trading_blocked||account.trade_suspended_by_user){
			await persistSubmissionFailure(order.id,userId,'PAPER_ACCOUNT_UNAVAILABLE',OrderStatus.REJECTED);
			throw new AlpacaPaperOrderError('ALPACA_PAPER_ACCOUNT_UNAVAILABLE',503);
		}
		await db.order.update({where:{id:order.id},data:{providerAccountId:account.id}});
		asset=await provider.getAsset(order.instrument.symbol);
		if(asset.status.toLowerCase()!=='active'||!asset.tradable||!['us_equity','crypto'].includes(asset.class.toLowerCase())){
			await persistSubmissionFailure(order.id,userId,'ASSET_NOT_TRADABLE',OrderStatus.REJECTED);
			throw new AlpacaPaperOrderError('ALPACA_PAPER_ASSET_NOT_TRADABLE',422);
		}
	}catch(error){
		if(error instanceof AlpacaPaperOrderError)throw error;
		const providerStatus=error instanceof AlpacaTradingApiError?`PRECHECK_FAILED:${error.status}`:'PRECHECK_UNAVAILABLE';
		const status=error instanceof AlpacaTradingApiError&&[401,403,404,422].includes(error.status)?OrderStatus.REJECTED:OrderStatus.OPEN;
		await persistSubmissionFailure(order.id,userId,providerStatus,status);
		throw new AlpacaPaperOrderError(providerStatus,status===OrderStatus.REJECTED?422:503);
	}

	try{
		const response=await provider.submitOrder({
			clientOrderId:idempotencyKey,accountId:account.id,symbol:order.instrument.symbol,
			side:input.side,type:input.type,quantity:new Prisma.Decimal(input.quantity).toString(),
			timeInForce:order.instrument.quoteAsset==='USD'&&asset.class.toLowerCase()==='crypto'?'gtc':'day',
			limitPrice:order.price?.toString(),
			stopPrice:order.stopPrice?.toString(),
		},idempotencyKey);
		return await persistProviderOrder(order.id,response,account.id,userId);
	}catch(error){
		if(error instanceof AlpacaPaperOrderError)throw error;
		if(error instanceof AlpacaTradingApiError){
			const failed=await persistSubmissionFailure(order.id,userId,`REJECTED:${error.status}`,OrderStatus.REJECTED);
			void failed;
			throw new AlpacaPaperOrderError(`ALPACA_PAPER_ORDER_REJECTED:${error.status}`,422);
		}
		await persistSubmissionFailure(order.id,userId,'SUBMISSION_UNKNOWN',OrderStatus.OPEN);
		return db.order.findUniqueOrThrow({where:{id:order.id},include:{executions:true,instrument:true}});
	}
}

export async function syncAlpacaPaperOrder(orderId:string,actorId:string){
	if(!getServerConfiguration().execution.alpacaPaperOrdersEnabled)throw new AlpacaPaperOrderError('ALPACA_PAPER_ORDERS_DISABLED',403);
	const provider=createIndividualTradingApiProviderFromEnvironment();
	if(!provider)throw new AlpacaPaperOrderError('ALPACA_PAPER_NOT_CONFIGURED',503);
	const order=await db.order.findUnique({where:{id:orderId},include:{instrument:true,executions:true}});
	if(!order||order.accountMode!==AccountMode.REAL||order.providerName!==ALPACA_PAPER_PROVIDER)throw new AlpacaPaperOrderError('ALPACA_PAPER_ORDER_NOT_FOUND',404);
	const account=await provider.getAccount();
	if(order.providerAccountId&&order.providerAccountId!==account.id)throw new AlpacaPaperOrderError('ALPACA_PAPER_ACCOUNT_MISMATCH',409);
	let response:ProviderOrder;
	try{
		response=order.providerOrderId
			?await provider.getOrderStatus(order.providerOrderId)
			:await provider.getOrderByClientId(order.idempotencyKey??'');
	}catch(error){
		if(error instanceof AlpacaTradingApiError&&error.status===404)throw new AlpacaPaperOrderError('ALPACA_PAPER_ORDER_NOT_FOUND_AT_PROVIDER',404);
		if(error instanceof AlpacaTradingApiError&&(error.status===401||error.status===403))throw new AlpacaPaperOrderError('ALPACA_PAPER_AUTHENTICATION_FAILED',503);
		throw new AlpacaPaperOrderError('ALPACA_PAPER_ORDER_STATUS_UNAVAILABLE',503);
	}
	return persistProviderOrder(order.id,response,account.id,actorId);
}

export async function cancelAlpacaPaperOrder(orderId:string,userId:string){
	if(!getServerConfiguration().execution.alpacaPaperOrdersEnabled)throw new AlpacaPaperOrderError('ALPACA_PAPER_ORDERS_DISABLED',403);
	const provider=createIndividualTradingApiProviderFromEnvironment();
	if(!provider)throw new AlpacaPaperOrderError('ALPACA_PAPER_NOT_CONFIGURED',503);
	const order=await db.order.findFirst({where:{id:orderId,userId,accountMode:AccountMode.REAL,providerName:ALPACA_PAPER_PROVIDER},include:{instrument:true,executions:true}});
	if(!order||!order.providerAccountId||!order.providerOrderId)throw new AlpacaPaperOrderError('ALPACA_PAPER_ORDER_NOT_FOUND',404);
	if(order.status!==OrderStatus.OPEN&&order.status!==OrderStatus.PARTIALLY_FILLED)throw new AlpacaPaperOrderError('ORDER_NOT_OPEN',409);
	try{
		const response=await provider.cancelOrder(order.providerOrderId,order.idempotencyKey??order.id);
		return await persistProviderOrder(order.id,response,order.providerAccountId,userId);
	}catch(error){
		if(error instanceof AlpacaPaperOrderError)throw error;
		if(error instanceof AlpacaTradingApiError&&(error.status===401||error.status===403))throw new AlpacaPaperOrderError('ALPACA_PAPER_AUTHENTICATION_FAILED',503);
		try{
			const latest=await provider.getOrderStatus(order.providerOrderId);
			return await persistProviderOrder(order.id,latest,order.providerAccountId,userId);
		}catch(statusError){
			if(statusError instanceof AlpacaPaperOrderError)throw statusError;
		}
		throw new AlpacaPaperOrderError('ALPACA_PAPER_CANCEL_FAILED',409);
	}
}

import {AccountMode,NotificationType,OrderSide,OrderStatus,OrderType,Prisma} from '@prisma/client';
import {beforeEach,describe,expect,it,vi} from 'vitest';

const mocks=vi.hoisted(()=>({
	providerFactory:vi.fn(),
	ensureUserLedger:vi.fn(),
	balance:vi.fn(),
	reservedWithdrawalAmount:vi.fn(),
}));

vi.mock('@/lib/db',()=>({db:{
	$orderTransaction:vi.fn(),
	order:{findUnique:vi.fn(),findUniqueOrThrow:vi.fn(),create:vi.fn(),update:vi.fn()},
	user:{findUnique:vi.fn()},
	instrument:{findUnique:vi.fn()},
	auditLog:{create:vi.fn()},
	ledgerEntry:{create:vi.fn()},
	position:{create:vi.fn()},
	execution:{create:vi.fn()},
}}));
vi.mock('@/lib/notifications',()=>({createNotification:vi.fn()}));
vi.mock('@/lib/ledger',()=>({
	ensureUserLedger:mocks.ensureUserLedger,
	balance:mocks.balance,
	reservedWithdrawalAmount:mocks.reservedWithdrawalAmount,
}));
vi.mock('@/lib/providers/alpaca-crypto-provider',async importOriginal=>{
	const original=await importOriginal<typeof import('@/lib/providers/alpaca-crypto-provider')>();
	return {...original,createIndividualTradingApiProviderFromEnvironment:mocks.providerFactory};
});

import {db} from '@/lib/db';
import {createNotification} from '@/lib/notifications';
import {submitAlpacaPaperOrder} from '@/lib/alpaca-paper-orders';
import type {ProviderOrder} from '@/lib/providers/contracts';

const now=new Date();
const instrument={id:'instrument-1',symbol:'AAPL',enabled:true,updatedAt:now,quoteAsset:'USD',takerFee:new Prisma.Decimal('0.01')};
const request={instrumentId:instrument.id,side:OrderSide.BUY,type:OrderType.MARKET,quantity:2,expectedPrice:100,observedAt:now.toISOString()};
const idempotencyKey='paper-order-key-001';
type MockOrder={
	[key:string]:unknown;
	id:string;
	idempotencyKey:string;
	quantity:Prisma.Decimal;
	filledQuantity:Prisma.Decimal;
	price:Prisma.Decimal|null;
	stopPrice:Prisma.Decimal|null;
	averageFillPrice:Prisma.Decimal|null;
	executions:unknown[];
	instrument:typeof instrument;
};
type MockProvider={
	getAccount:ReturnType<typeof vi.fn>;
	getAsset:ReturnType<typeof vi.fn>;
	submitOrder:ReturnType<typeof vi.fn>;
	getOrderStatus:ReturnType<typeof vi.fn>;
	getOrderByClientId:ReturnType<typeof vi.fn>;
	cancelOrder:ReturnType<typeof vi.fn>;
};
let storedOrder:MockOrder|null=null;
let provider:MockProvider;

function decimal(value:unknown):Prisma.Decimal{
	if(value instanceof Prisma.Decimal)return value;
	if(typeof value==='number'||typeof value==='string')return new Prisma.Decimal(value);
	throw new Error('Expected a decimal mock value.');
}

function nullableDecimal(value:unknown):Prisma.Decimal|null{
	return value===null||value===undefined?null:decimal(value);
}

function updateStoredOrder(existing:MockOrder,data:Record<string,unknown>):MockOrder{
	return {
		...existing,
		...data,
		id:existing.id,
		idempotencyKey:typeof data.idempotencyKey==='string'?data.idempotencyKey:existing.idempotencyKey,
		quantity:data.quantity===undefined?existing.quantity:decimal(data.quantity),
		filledQuantity:data.filledQuantity===undefined?existing.filledQuantity:decimal(data.filledQuantity),
		price:data.price===undefined?existing.price:nullableDecimal(data.price),
		stopPrice:data.stopPrice===undefined?existing.stopPrice:nullableDecimal(data.stopPrice),
		averageFillPrice:data.averageFillPrice===undefined?existing.averageFillPrice:nullableDecimal(data.averageFillPrice),
		executions:Array.isArray(data.executions)?data.executions:existing.executions,
		instrument:existing.instrument,
	};
}

function providerOrder(state:ProviderOrder['state'],filledQuantity='0'):ProviderOrder{
	return {
		providerOrderId:'alpaca-order-1',
		clientOrderId:idempotencyKey,
		state,
		providerStatus:state.toLowerCase(),
		acceptedAt:now.toISOString(),
		updatedAt:now.toISOString(),
		executions:[],
		filledQuantity,
		...(Number(filledQuantity)>0?{averageFillPrice:'101.25'}:{}),
	};
}

function matches(where:Record<string,unknown>){
	if(typeof where.idempotencyKey==='string')return storedOrder?.idempotencyKey===where.idempotencyKey?storedOrder:null;
	if(where.id)return storedOrder?.id===where.id?storedOrder:null;
	return null;
}

beforeEach(()=>{
	vi.clearAllMocks();
	vi.stubEnv('ALPACA_PAPER_ORDERS_ENABLED','true');
	storedOrder=null;
	mocks.ensureUserLedger.mockResolvedValue({id:'real-usd-ledger',currency:'USD'});
	mocks.balance.mockResolvedValue(new Prisma.Decimal(1000));
	mocks.reservedWithdrawalAmount.mockResolvedValue(new Prisma.Decimal(0));
	provider={
		getAccount:vi.fn().mockResolvedValue({id:'paper-account-1',status:'ACTIVE',account_blocked:false,trading_blocked:false,trade_suspended_by_user:false}),
		getAsset:vi.fn().mockResolvedValue({id:'asset-1',symbol:'AAPL',class:'us_equity',status:'active',tradable:true}),
		submitOrder:vi.fn().mockResolvedValue(providerOrder('FILLED','2')),
		getOrderStatus:vi.fn(),
		getOrderByClientId:vi.fn(),
		cancelOrder:vi.fn(),
	};
	mocks.providerFactory.mockReturnValue(provider);
	const dbMock=db as unknown as {
		$transaction:ReturnType<typeof vi.fn>;
		order:{
			findUnique:ReturnType<typeof vi.fn>;
			findUniqueOrThrow:ReturnType<typeof vi.fn>;
			update:ReturnType<typeof vi.fn>;
		};
	};
	dbMock.$transaction=vi.fn(async(callback:(tx:unknown)=>Promise<unknown>)=>callback({
		order:{
			findUnique:vi.fn(async({where}: {where:Record<string,unknown>})=>matches(where)),
			findUniqueOrThrow:vi.fn(async({where}: {where:Record<string,unknown>})=>matches(where)),
			findMany:vi.fn().mockResolvedValue([]),
			create:vi.fn(async({data}: {data:Record<string,unknown>})=>{
				storedOrder={
					...data,
					id:'local-order-1',
					idempotencyKey:String(data.idempotencyKey),
					price:nullableDecimal(data.price),
					stopPrice:nullableDecimal(data.stopPrice),
					quantity:decimal(data.quantity),
					filledQuantity:new Prisma.Decimal(0),
					averageFillPrice:null,
					executions:[],
					instrument,
				};
				return storedOrder;
			}),
			update:vi.fn(async({where,data}: {where:{id:string};data:Record<string,unknown>})=>{
				if(!storedOrder||storedOrder.id!==where.id)throw new Error('missing order');
				storedOrder=updateStoredOrder(storedOrder,data);
				return storedOrder;
			}),
		},
		user:{findUnique:vi.fn().mockResolvedValue({id:'user-1',accountMode:AccountMode.REAL,status:'ACTIVE',accountRestricted:false,role:'USER'})},
		instrument:{findUnique:vi.fn().mockResolvedValue(instrument)},
		auditLog:{create:vi.fn().mockResolvedValue({})},
	}));
	dbMock.order.findUnique.mockImplementation(async({where}: {where:Record<string,unknown>})=>matches(where));
	dbMock.order.findUniqueOrThrow.mockImplementation(async({where}: {where:Record<string,unknown>})=>{
		const order=matches(where);
		if(!order)throw new Error('missing order');
		return order;
	});
	dbMock.order.update.mockImplementation(async({where,data}: {where:{id:string};data:Record<string,unknown>})=>{
		if(!storedOrder||storedOrder.id!==where.id)throw new Error('missing order');
		storedOrder=updateStoredOrder(storedOrder,data);
		return storedOrder;
	});
});

describe('Alpaca Paper order isolation and status handling',()=>{
	it('records a verified paper fill without creating Aurevia ledger, execution, or position records',async()=>{
		const order=await submitAlpacaPaperOrder('user-1',request,idempotencyKey);

		expect(order).toMatchObject({accountMode:AccountMode.REAL,providerName:'alpaca-paper',providerAccountId:'paper-account-1',providerOrderId:'alpaca-order-1',status:OrderStatus.FILLED,providerStatus:'filled',filledQuantity:new Prisma.Decimal(2)});
		expect(order.providerReservedAmount?.toString()).toBe('202');
		expect(provider.submitOrder).toHaveBeenCalledTimes(1);
		expect(db.ledgerEntry.create).not.toHaveBeenCalled();
		expect(db.position.create).not.toHaveBeenCalled();
		expect(db.execution.create).not.toHaveBeenCalled();
		expect(createNotification).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({type:NotificationType.TRADE}));
	});

	it.each([
		['PARTIALLY_FILLED','1',OrderStatus.PARTIALLY_FILLED],
		['CANCELLED','0',OrderStatus.CANCELLED],
		['REJECTED','0',OrderStatus.REJECTED],
	] as const)('maps provider %s status into the local order status',async(state,filled,status)=>{
		provider.submitOrder.mockResolvedValue(providerOrder(state,filled));
		const order=await submitAlpacaPaperOrder('user-1',request,idempotencyKey);
		expect(order.status).toBe(status);
		expect(order.providerStatus).toBe(state.toLowerCase());
	});

	it('returns the existing matching order for a repeated idempotency key without resubmitting',async()=>{
		const first=await submitAlpacaPaperOrder('user-1',request,idempotencyKey);
		const repeated=await submitAlpacaPaperOrder('user-1',request,idempotencyKey);

		expect(repeated.id).toBe(first.id);
		expect(provider.submitOrder).toHaveBeenCalledTimes(1);
	});

	it('does not submit a REAL paper buy when the Aurevia USD ledger lacks collateral',async()=>{
		mocks.balance.mockResolvedValue(new Prisma.Decimal(100));
		await expect(submitAlpacaPaperOrder('user-1',request,idempotencyKey)).rejects.toMatchObject({code:'INSUFFICIENT_REAL_WALLET_COLLATERAL'});
		expect(provider.submitOrder).not.toHaveBeenCalled();
		expect(storedOrder).toBeNull();
	});

	it('does not resubmit an order whose first provider outcome was ambiguous',async()=>{
		provider.submitOrder.mockRejectedValueOnce(new Error('network unavailable'));
		const first=await submitAlpacaPaperOrder('user-1',request,idempotencyKey);
		const repeated=await submitAlpacaPaperOrder('user-1',request,idempotencyKey);

		expect(first.providerStatus).toBe('SUBMISSION_UNKNOWN');
		expect(repeated.id).toBe(first.id);
		expect(provider.submitOrder).toHaveBeenCalledTimes(1);
	});
});

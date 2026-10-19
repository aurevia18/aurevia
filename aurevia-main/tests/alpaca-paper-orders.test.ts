import {AccountMode,NotificationType,OrderSide,OrderStatus,OrderType,Prisma} from '@prisma/client';
import {beforeEach,describe,expect,it,vi} from 'vitest';

const mocks=vi.hoisted(()=>({
	providerFactory:vi.fn(),
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
vi.mock('@/lib/providers/alpaca-crypto-provider',async importOriginal=>{
	const original=await importOriginal<typeof import('@/lib/providers/alpaca-crypto-provider')>();
	return {...original,createIndividualTradingApiProviderFromEnvironment:mocks.providerFactory};
});

import {db} from '@/lib/db';
import {createNotification} from '@/lib/notifications';
import {submitAlpacaPaperOrder} from '@/lib/alpaca-paper-orders';
import type {ProviderOrder} from '@/lib/providers/contracts';

const now=new Date();
const instrument={id:'instrument-1',symbol:'AAPL',enabled:true,updatedAt:now,quoteAsset:'USD'};
const request={instrumentId:instrument.id,side:OrderSide.BUY,type:OrderType.MARKET,quantity:2,expectedPrice:100,observedAt:now.toISOString()};
const idempotencyKey='paper-order-key-001';
let storedOrder:Record<string,any>|null=null;
let provider:Record<string,any>;

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
	if(where.idempotencyKey)return storedOrder?.idempotencyKey===where.idempotencyKey?storedOrder:null;
	if(where.id)return storedOrder?.id===where.id?storedOrder:null;
	return null;
}

beforeEach(()=>{
	vi.clearAllMocks();
	vi.stubEnv('ALPACA_PAPER_ORDERS_ENABLED','true');
	storedOrder=null;
	provider={
		getAccount:vi.fn().mockResolvedValue({id:'paper-account-1',status:'ACTIVE',account_blocked:false,trading_blocked:false,trade_suspended_by_user:false}),
		getAsset:vi.fn().mockResolvedValue({id:'asset-1',symbol:'AAPL',class:'us_equity',status:'active',tradable:true}),
		submitOrder:vi.fn().mockResolvedValue(providerOrder('FILLED','2')),
		getOrderStatus:vi.fn(),
		getOrderByClientId:vi.fn(),
		cancelOrder:vi.fn(),
	};
	mocks.providerFactory.mockReturnValue(provider);
	(db as any).$transaction=vi.fn(async(callback: (tx:unknown)=>Promise<unknown>)=>callback({
		order:{
			findUnique:vi.fn(async({where}: {where:Record<string,unknown>})=>matches(where)),
			findUniqueOrThrow:vi.fn(async({where}: {where:Record<string,unknown>})=>matches(where)),
			findMany:vi.fn().mockResolvedValue([]),
			create:vi.fn(async({data}: {data:Record<string,any>})=>{
				storedOrder={...data,id:'local-order-1',price:data.price??null,stopPrice:data.stopPrice??null,quantity:new Prisma.Decimal(data.quantity),filledQuantity:new Prisma.Decimal(0),averageFillPrice:null,executions:[],instrument};
				return storedOrder;
			}),
			update:vi.fn(async({where,data}: {where:{id:string};data:Record<string,any>})=>{
				if(!storedOrder||storedOrder.id!==where.id)throw new Error('missing order');
				storedOrder={...storedOrder,...data};
				return storedOrder;
			}),
		},
		user:{findUnique:vi.fn().mockResolvedValue({id:'user-1',accountMode:AccountMode.REAL,status:'ACTIVE',accountRestricted:false,role:'USER'})},
		instrument:{findUnique:vi.fn().mockResolvedValue(instrument)},
		auditLog:{create:vi.fn().mockResolvedValue({})},
	}));
	(db.order.findUnique as any).mockImplementation(async({where}: {where:Record<string,unknown>})=>matches(where));
	(db.order.findUniqueOrThrow as any).mockImplementation(async({where}: {where:Record<string,unknown>})=>{
		const order=matches(where);
		if(!order)throw new Error('missing order');
		return order;
	});
	(db.order.update as any).mockImplementation(async({where,data}: {where:{id:string};data:Record<string,any>})=>{
		if(!storedOrder||storedOrder.id!==where.id)throw new Error('missing order');
		storedOrder={...storedOrder,...data};
		return storedOrder;
	});
});

describe('Alpaca Paper order isolation and status handling',()=>{
	it('records a verified paper fill without creating Aurevia ledger, execution, or position records',async()=>{
		const order=await submitAlpacaPaperOrder('user-1',request,idempotencyKey);

		expect(order).toMatchObject({accountMode:AccountMode.REAL,providerName:'alpaca-paper',providerAccountId:'paper-account-1',providerOrderId:'alpaca-order-1',status:OrderStatus.FILLED,providerStatus:'filled',filledQuantity:new Prisma.Decimal(2)});
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

	it('does not resubmit an order whose first provider outcome was ambiguous',async()=>{
		provider.submitOrder.mockRejectedValueOnce(new Error('network unavailable'));
		const first=await submitAlpacaPaperOrder('user-1',request,idempotencyKey);
		const repeated=await submitAlpacaPaperOrder('user-1',request,idempotencyKey);

		expect(first.providerStatus).toBe('SUBMISSION_UNKNOWN');
		expect(repeated.id).toBe(first.id);
		expect(provider.submitOrder).toHaveBeenCalledTimes(1);
	});
});

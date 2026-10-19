import {describe,expect,it,vi} from 'vitest';
import {AlpacaTradingApiError,IndividualAlpacaTradingProvider} from '@/lib/providers/alpaca-crypto-provider';

const account={
	id:'paper-account-1',status:'ACTIVE',currency:'USD',cash:'100000',buying_power:'200000',equity:'100000',
	portfolio_value:'100000',pattern_day_trader:false,trade_suspended_by_user:false,trading_blocked:false,account_blocked:false,
};
const providerOrder={
	id:'provider-order-1',client_order_id:'client-order-123456',status:'new',created_at:'2026-01-01T12:00:00.000Z',
	updated_at:'2026-01-01T12:00:00.000Z',filled_qty:'0',
};

function provider(fetcher:typeof fetch){
	return new IndividualAlpacaTradingProvider({
		baseUrl:'https://paper-api.alpaca.markets/v2',
		apiKey:'test-api-key',
		apiSecret:'test-api-secret',
		fetcher,
	});
}

describe('Alpaca Paper provider validation',()=>{
	it('reads a validated account through the paper endpoint',async()=>{
		const {pattern_day_trader:_patternDayTrader,...accountWithoutOptionalField}=account;
		const fetcher=vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(accountWithoutOptionalField),{status:200}));
		const response=await provider(fetcher).getAccount();

		expect(response).toEqual(accountWithoutOptionalField);
		expect(fetcher.mock.calls[0]?.[0]).toBe('https://paper-api.alpaca.markets/v2/account');
		expect(fetcher.mock.calls[0]?.[1]?.headers).toMatchObject({
			'APCA-API-KEY-ID':'test-api-key',
			'APCA-API-SECRET-KEY':'test-api-secret',
		});
	});

	it('reports provider authentication errors without including credentials',async()=>{
		const fetcher=vi.fn<typeof fetch>().mockResolvedValue(new Response('private provider message',{status:401}));
		const client=provider(fetcher);
		const error=await client.getAccount().catch(exception=>exception);

		expect(error).toBeInstanceOf(AlpacaTradingApiError);
		expect((error as Error).message).toBe('ALPACA_TRADING_API_ERROR:401');
		expect((error as Error).message).not.toContain('test-api-secret');
		expect(fetcher).toHaveBeenCalledTimes(1);
	});

	it('rejects incomplete provider order responses instead of fabricating client IDs or timestamps',async()=>{
		const fetcher=vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
			id:'provider-order-1',status:'new',filled_qty:'0',
		}),{status:200}));

		await expect(provider(fetcher).submitOrder({
			clientOrderId:'client-order-123456',accountId:'paper-account-1',symbol:'AAPL',side:'BUY',type:'MARKET',quantity:'1',
		},'client-order-123456')).rejects.toThrow('ALPACA_TRADING_API_INVALID_ORDER_RESPONSE');
	});

	it('submits only to the configured paper host with the local idempotency key',async()=>{
		const fetcher=vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(providerOrder),{status:200}));
		const response=await provider(fetcher).submitOrder({
			clientOrderId:'client-order-123456',accountId:'paper-account-1',symbol:'AAPL',side:'BUY',type:'MARKET',quantity:'1',
		},'client-order-123456');

		expect(response).toMatchObject({providerOrderId:'provider-order-1',clientOrderId:'client-order-123456',state:'ACCEPTED',providerStatus:'new'});
		expect(fetcher.mock.calls[0]?.[0]).toBe('https://paper-api.alpaca.markets/v2/orders');
		expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({client_order_id:'client-order-123456',qty:'1',symbol:'AAPL'});
	});

	it('rejects an accepted provider order whose client ID does not match the idempotency key',async()=>{
		const fetcher=vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({...providerOrder,client_order_id:'different-client-order'}),{status:200}));

		await expect(provider(fetcher).submitOrder({
			clientOrderId:'client-order-123456',accountId:'paper-account-1',symbol:'AAPL',side:'BUY',type:'MARKET',quantity:'1',
		},'client-order-123456')).rejects.toThrow('ALPACA_TRADING_API_INVALID_ORDER_RESPONSE');
	});
});

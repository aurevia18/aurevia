import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';

const mocks=vi.hoisted(()=>({
	finnhubQuote:vi.fn(),
	finnhubHistory:vi.fn(),
	findFirst:vi.fn(),
}));

vi.mock('@/lib/live-market',()=>({
	getMarketQuote:mocks.finnhubQuote,
	getMarketHistory:mocks.finnhubHistory,
}));
vi.mock('@/lib/db',()=>({db:{instrument:{findFirst:mocks.findFirst}}}));

import {getMarketHistoryWithFallback,getMarketQuoteWithFallback} from '@/lib/market-data-service';

const asset={id:'AAPL',ticker:'AAPL',name:'Apple Inc.',type:'STOCK' as const,currency:'USD'};

beforeEach(()=>{
	mocks.finnhubQuote.mockReset();
	mocks.finnhubHistory.mockReset();
	mocks.findFirst.mockReset().mockResolvedValue(null);
	vi.spyOn(console,'warn').mockImplementation(()=>undefined);
});
afterEach(()=>vi.restoreAllMocks());

describe('internal market data fallback',()=>{
	it('uses internal prices when no Finnhub credential is configured',async()=>{
		const quote=await getMarketQuoteWithFallback(asset,'');
		expect(quote).toMatchObject({asset,source:'Aurevia Internal',isStale:false});
		expect(quote.price).toBeGreaterThan(0);
		expect(mocks.finnhubQuote).not.toHaveBeenCalled();
	});

	it('uses a current Finnhub quote when available',async()=>{
		const liveQuote={asset,price:225,change:2,changePercent:0.9,updatedAt:new Date().toISOString(),source:'Finnhub',isStale:false};
		mocks.finnhubQuote.mockResolvedValue(liveQuote);
		await expect(getMarketQuoteWithFallback(asset,'server-key')).resolves.toBe(liveQuote);
	});

	it('falls back to internal prices when Finnhub fails or returns a stale quote',async()=>{
		mocks.finnhubQuote.mockRejectedValueOnce(new Error('provider offline'));
		const failedQuote=await getMarketQuoteWithFallback(asset,'server-key');
		expect(failedQuote.source).toBe('Aurevia Internal');

		mocks.finnhubQuote.mockResolvedValueOnce({asset,price:225,source:'Finnhub',isStale:true});
		const staleQuote=await getMarketQuoteWithFallback(asset,'server-key');
		expect(staleQuote.source).toBe('Aurevia Internal');
		expect(console.warn).toHaveBeenCalledTimes(2);
	});

	it('provides internal chart history when Finnhub history is unavailable',async()=>{
		mocks.finnhubHistory.mockRejectedValue(new Error('provider offline'));
		const history=await getMarketHistoryWithFallback(asset,'1d','server-key');
		expect(history.source).toBe('Aurevia Internal');
		expect(history.candles).toHaveLength(60);
		expect(history.candles.at(-1)?.close).toBe(history.quote.price);
	});
});

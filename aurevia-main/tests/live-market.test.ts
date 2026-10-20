import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {filterSupportedMarketAssets,getMarketAsset,getMarketHistory,getMarketQuote} from '../lib/live-market';

afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();vi.unstubAllEnvs()});

describe('Finnhub market service',()=>{
	beforeEach(()=>vi.stubEnv('FINNHUB_API_KEY',''));

	it('parses Finnhub quotes and historical OHLCV candles',async()=>{
		const now=Math.floor(Date.now()/1000);
		const fetcher=vi.fn()
			.mockResolvedValueOnce(new Response(JSON.stringify({c:41000,d:1000,dp:2.5,o:40500,h:41500,l:40400,pc:40000,t:now}),{status:200}))
			.mockResolvedValueOnce(new Response(JSON.stringify({s:'ok',t:[now-60,now],o:[40000,40500],h:[40500,41500],l:[39900,40400],c:[40400,41000],v:[12,34]}),{status:200}))
			.mockResolvedValueOnce(new Response(JSON.stringify({c:41000,d:1000,dp:2.5,o:40500,h:41500,l:40400,pc:40000,t:now}),{status:200}));
		vi.stubGlobal('fetch',fetcher);
		const asset=getMarketAsset('DJI')!;
		const quote=await getMarketQuote(asset,'test-finnhub-key');
		expect(quote).toMatchObject({price:41000,change:1000,changePercent:2.5,source:'Finnhub'});
		const history=await getMarketHistory(asset,'1d','test-finnhub-key');
		expect(history.candles).toHaveLength(2);
		expect(history.candles[1]).toMatchObject({open:40500,high:41500,low:40400,close:41000,volume:34});
		expect(fetcher).toHaveBeenCalledTimes(3);
	});

	it('maps Finnhub throttling to a retryable service error',async()=>{
		vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('{}',{status:429})));
		await expect(getMarketQuote(getMarketAsset('MERV')!,'test-finnhub-key')).rejects.toMatchObject({status:503});
	});

	it('returns its last successful provider quote with an explicit stale marker after a failure',async()=>{
		const asset={id:'STALE_CACHE_TEST',ticker:'STALE_CACHE_TEST',name:'Stale cache test',type:'STOCK' as const,currency:'USD'};
		const payload={c:123,d:1,dp:0.8,o:122,h:124,l:121,pc:122,t:Math.floor(Date.now()/1000)};
		const fetcher=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(payload),{status:200})).mockRejectedValueOnce(new Error('offline'));
		vi.stubGlobal('fetch',fetcher);
		const current=await getMarketQuote(asset,'test-finnhub-key');
		vi.useFakeTimers();
		await vi.advanceTimersByTimeAsync(9_000);
		const stale=await getMarketQuote(asset,'test-finnhub-key');
		expect(stale.price).toBe(current.price);
		expect(stale.isStale).toBe(true);
		expect(stale.staleReason).toContain('unreachable');
	});

	it('marks provider quotes stale when their quote timestamp is old',async()=>{
		const asset={id:'OLD_PROVIDER_QUOTE_TEST',ticker:'OLD_PROVIDER_QUOTE_TEST',name:'Old provider quote test',type:'STOCK' as const,currency:'USD'};
		const payload={c:123,d:1,dp:0.8,o:122,h:124,l:121,pc:122,t:Math.floor(Date.now()/1000)-6*60};
		vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify(payload),{status:200})));
		const quote=await getMarketQuote(asset,'test-finnhub-key');
		expect(quote.isStale).toBe(true);
		expect(quote.staleReason).toContain('older than five minutes');
	});

	it('rejects unknown symbols at lookup',()=>{
		expect(getMarketAsset('NOT-A-REAL-SYMBOL')).toBeUndefined();
	});

	it('filters synthetic trading symbols from a market asset batch',()=>{
		expect(filterSupportedMarketAssets([{symbol:'DJI'},{symbol:'E2E917F9FA/USD'}])).toEqual([{symbol:'DJI'}]);
	});

	it('uses the server-only key for Finnhub and identifies its quote source',async()=>{
		const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({c:190,d:2,dp:1.06,o:188,h:192,l:187,pc:188,t:Math.floor(Date.now()/1000)}),{status:200}));
		vi.stubGlobal('fetch',fetcher);
		const quote=await getMarketQuote(getMarketAsset('AAPL')!,'server-only-finnhub-test-key');
		expect(quote).toMatchObject({price:190,source:'Finnhub',change:2});
		expect(fetcher.mock.calls[0][1].headers['X-Finnhub-Token']).toBe('server-only-finnhub-test-key');
		expect(fetcher.mock.calls[0][0]).toContain('/quote?symbol=AAPL');
	});

	it('does not call a separate external provider after Finnhub fails',async()=>{
		const fetcher=vi.fn().mockResolvedValue(new Response('{}',{status:401}));
		vi.stubGlobal('fetch',fetcher);
		const asset={id:'FINNHUB_FALLBACK_TEST',ticker:'AAPL',name:'Finnhub fallback test',type:'STOCK' as const,currency:'USD'};
		await expect(getMarketQuote(asset,'invalid-test-key')).rejects.toMatchObject({status:401});
		expect(fetcher).toHaveBeenCalledOnce();
	});

	it('rejects Finnhub quotes that contain no valid price',async()=>{
		vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({c:0,d:0,dp:0,t:Math.floor(Date.now()/1000)}),{status:200})));
		await expect(getMarketQuote({id:'NO_PRICE_TEST',ticker:'NO_PRICE_TEST',name:'No price test',type:'STOCK',currency:'USD'},'test-key')).rejects.toMatchObject({status:503});
	});

	it('rejects provider quotes without required metadata rather than inventing it',async()=>{
		vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({c:42,o:41,h:43,l:40}),{status:200})));
		await expect(getMarketQuote({id:'INCOMPLETE_QUOTE_TEST',ticker:'INCOMPLETE_QUOTE_TEST',name:'Incomplete quote test',type:'STOCK',currency:'USD'},'test-key')).rejects.toMatchObject({status:502});
	});

	it('keeps missing historical volume unavailable rather than reporting zero',async()=>{
		const now=Math.floor(Date.now()/1000);
		vi.stubGlobal('fetch',vi.fn()
			.mockResolvedValueOnce(new Response(JSON.stringify({s:'ok',t:[now-60],o:[40],h:[43],l:[39],c:[42],v:[null]}),{status:200}))
			.mockResolvedValueOnce(new Response(JSON.stringify({c:42,d:1,dp:2.4,o:41,h:43,l:39,pc:41,t:now}),{status:200})));
		const history=await getMarketHistory({id:'NO_VOLUME_TEST',ticker:'NO_VOLUME_TEST',name:'No volume test',type:'STOCK',currency:'USD'},'1d','test-finnhub-key');
		expect(history.candles[0].volume).toBeNull();
	});

	it('reads Finnhub historical candles without inventing missing bars',async()=>{
		const now=Math.floor(Date.now()/1000);
		const fetcher=vi.fn()
			.mockResolvedValueOnce(new Response(JSON.stringify({s:'ok',t:[now-60,now],o:[188,189],h:[190,192],l:[187,188],c:[189,191],v:[10,20]}),{status:200}))
			.mockResolvedValueOnce(new Response(JSON.stringify({c:191,d:3,dp:1.59,o:189,h:192,l:188,pc:188,t:now}),{status:200}));
		vi.stubGlobal('fetch',fetcher);
		const history=await getMarketHistory(getMarketAsset('AAPL')!,'1d','test-finnhub-key');
		expect(history.source).toBe('Finnhub');
		expect(history.candles).toHaveLength(2);
		expect(history.candles[1]).toMatchObject({open:189,high:192,low:188,close:191,volume:20});
	});
});

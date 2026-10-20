import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';

const mocks=vi.hoisted(()=>({
	requireUser:vi.fn(),
	findUnique:vi.fn(),
	upsert:vi.fn(),
	rateLimit:vi.fn(),
	getConfiguration:vi.fn(),
	finnhubQuote:vi.fn(),
}));

vi.mock('@/lib/auth',()=>({requireUser:mocks.requireUser}));
vi.mock('@/lib/db',()=>({db:{exchangeRate:{findUnique:mocks.findUnique,upsert:mocks.upsert}}}));
vi.mock('@/lib/rate-limit',()=>({rateLimit:mocks.rateLimit}));
vi.mock('@/lib/config/env',()=>({getServerConfiguration:mocks.getConfiguration}));
vi.mock('@/lib/providers/finnhub-market-data',()=>({getFinnhubQuote:mocks.finnhubQuote}));

import {GET} from '@/app/api/currency-rates/route';

const request=new Request('http://localhost/api/currency-rates?to=EUR');

beforeEach(()=>{
	mocks.requireUser.mockReset().mockResolvedValue({id:'user-1'});
	mocks.findUnique.mockReset().mockResolvedValue(null);
	mocks.upsert.mockReset().mockImplementation(({create})=>Promise.resolve({...create}));
	mocks.rateLimit.mockReset();
	mocks.getConfiguration.mockReset().mockReturnValue({marketData:{finnhubApiKey:''}});
	mocks.finnhubQuote.mockReset();
	vi.spyOn(console,'warn').mockImplementation(()=>undefined);
});
afterEach(()=>vi.restoreAllMocks());

describe('currency rate fallback',()=>{
	it('returns a disclosed internal reference rate when Finnhub and cached rates are absent',async()=>{
		const response=await GET(request);
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			baseCurrency:'USD',quoteCurrency:'EUR',source:'Aurevia internal reference rate',status:'INTERNAL',
		});
	});

	it('continues using the last known rate and labels it stale when the provider is unavailable',async()=>{
		mocks.findUnique.mockResolvedValue({
			rate:'0.91',source:'Finnhub',observedAt:new Date(Date.now()-48*60*60_000),
		});
		const response=await GET(request);
		expect(await response.json()).toMatchObject({rate:'0.91',source:'Finnhub',status:'STALE'});
	});

	it('uses and stores a valid Finnhub rate when available',async()=>{
		mocks.getConfiguration.mockReturnValue({marketData:{finnhubApiKey:'server-key'}});
		mocks.finnhubQuote.mockResolvedValue({price:0.93,source:'Finnhub',updatedAt:new Date().toISOString()});
		const response=await GET(request);
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({rate:0.93,source:'Finnhub',status:'CURRENT'});
		expect(mocks.upsert).toHaveBeenCalledOnce();
	});
});

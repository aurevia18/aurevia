import {AccountMode} from '@prisma/client';
import {beforeEach,describe,expect,it,vi} from 'vitest';

const mocks=vi.hoisted(()=>({
	requireUser:vi.fn(),
	findUnique:vi.fn(),
	placeOrder:vi.fn(),
	submitPaperOrder:vi.fn(),
	rateLimit:vi.fn(),
}));

vi.mock('@/lib/auth',()=>({requireUser:mocks.requireUser}));
vi.mock('@/lib/db',()=>({db:{user:{findUnique:mocks.findUnique}}}));
vi.mock('@/lib/orders',()=>({placeOrder:mocks.placeOrder}));
vi.mock('@/lib/notifications',()=>({createNotification:vi.fn()}));
vi.mock('@/lib/alpaca-paper-orders',()=>({
	submitAlpacaPaperOrder:mocks.submitPaperOrder,
	cancelAlpacaPaperOrder:vi.fn(),
	ALPACA_PAPER_PROVIDER:'alpaca-paper',
	AlpacaPaperOrderError:class extends Error{code='';httpStatus=409},
}));
vi.mock('@/lib/rate-limit',()=>({rateLimit:mocks.rateLimit}));

import {POST} from '@/app/api/orders/route';

const payload={instrumentId:'instrument-1',side:'BUY',type:'MARKET',quantity:1,expectedPrice:100,observedAt:new Date().toISOString()};
const request=()=>new Request('http://localhost/api/orders',{method:'POST',headers:{'content-type':'application/json','Idempotency-Key':'route-order-key-001'},body:JSON.stringify(payload)});

describe('order route mode separation',()=>{
	beforeEach(()=>{
		vi.clearAllMocks();
		mocks.requireUser.mockResolvedValue({id:'user-1',accountMode:AccountMode.DEMO});
		mocks.findUnique.mockResolvedValue({accountMode:AccountMode.DEMO,status:'ACTIVE',role:'USER'});
		mocks.placeOrder.mockResolvedValue({id:'demo-order'});
		mocks.submitPaperOrder.mockResolvedValue({id:'paper-order',providerStatus:'accepted'});
	});

	it('keeps DEMO orders on Aurevia simulated execution',async()=>{
		const response=await POST(request());

		expect(response.status).toBe(201);
		expect(mocks.placeOrder).toHaveBeenCalledWith('user-1',AccountMode.DEMO,expect.objectContaining({instrumentId:'instrument-1'}),'route-order-key-001');
		expect(mocks.submitPaperOrder).not.toHaveBeenCalled();
	});

	it('routes the database-confirmed REAL mode to Alpaca Paper only',async()=>{
		mocks.requireUser.mockResolvedValue({id:'user-1',accountMode:AccountMode.DEMO});
		mocks.findUnique.mockResolvedValue({accountMode:AccountMode.REAL,status:'ACTIVE',role:'USER'});

		const response=await POST(request());

		expect(response.status).toBe(201);
		expect(mocks.submitPaperOrder).toHaveBeenCalledWith('user-1',expect.objectContaining({instrumentId:'instrument-1'}),'route-order-key-001');
		expect(mocks.placeOrder).not.toHaveBeenCalled();
	});
});

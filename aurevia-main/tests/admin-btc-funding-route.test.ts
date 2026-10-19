import {AccountMode,FundingStatus,FundingType,Prisma} from '@prisma/client';
import {beforeEach,describe,expect,it,vi} from 'vitest';

const mocks=vi.hoisted(()=>({
	requireAdmin:vi.fn(),
	transaction:vi.fn(),
	userFindUnique:vi.fn(),
	ensureUserLedger:vi.fn(),
	ensureSystemAccount:vi.fn(),
	postDoubleEntry:vi.fn(),
	balance:vi.fn(),
	roundUsdAmount:vi.fn(),
	createNotification:vi.fn(),
	sendSupportEmail:vi.fn(),
}));

vi.mock('@/lib/auth',()=>({requireAdmin:mocks.requireAdmin}));
vi.mock('@/lib/db',()=>({db:{$transaction:mocks.transaction,user:{findUnique:mocks.userFindUnique}}}));
vi.mock('@/lib/ledger',()=>({
	ensureUserLedger:mocks.ensureUserLedger,
	ensureSystemAccount:mocks.ensureSystemAccount,
	postDoubleEntry:mocks.postDoubleEntry,
	balance:mocks.balance,
	roundUsdAmount:mocks.roundUsdAmount,
}));
vi.mock('@/lib/notifications',()=>({createNotification:mocks.createNotification}));
vi.mock('@/lib/email',()=>({sendSupportEmail:mocks.sendSupportEmail}));
vi.mock('@/lib/production-policy',()=>({validateDepositApproval:vi.fn()}));
vi.mock('@/lib/serializers',()=>({jsonSafe:(value:unknown)=>value}));

import {PATCH} from '@/app/api/admin/funding/route';

const transactionId='funding-btc-1';
let currentFunding:Record<string,unknown>;
let tx:Record<string,Record<string,ReturnType<typeof vi.fn>>>;

function reviewRequest(decision:string,extra:Record<string,unknown>={}){
	return new Request('https://aurevia.test/api/admin/funding',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({id:transactionId,decision,...extra})});
}

beforeEach(()=>{
	vi.clearAllMocks();
	currentFunding={
		id:transactionId,userId:'user-1',type:FundingType.DEPOSIT,method:'BTC deposit · manual verification',
		amount:new Prisma.Decimal('0.125'),currency:'BTC',network:'BITCOIN',transactionReference:'a'.repeat(64),
		status:FundingStatus.PENDING_REVIEW,accountMode:AccountMode.REAL,receiptKey:'private/receipt.png',
		verifiedAt:null,creditedAmount:null,creditedCurrency:null,settlementReference:null,updatedAt:new Date(),
	};
	tx={
		fundingRequest:{
			findUnique:vi.fn(async()=>({...currentFunding})),
			findUniqueOrThrow:vi.fn(async()=>({...currentFunding})),
			aggregate:vi.fn(),
			updateMany:vi.fn(async({data}:{data:Record<string,unknown>})=>{currentFunding={...currentFunding,...data,updatedAt:new Date()};return {count:1}}),
		},
		auditLog:{create:vi.fn().mockResolvedValue({})},
		user:{findUnique:vi.fn().mockResolvedValue({withdrawalEnabled:true,accountRestricted:false})},
	};
	mocks.requireAdmin.mockResolvedValue({id:'admin-1'});
	mocks.transaction.mockImplementation(async(callback:(transaction:unknown)=>Promise<unknown>)=>callback(tx));
	mocks.userFindUnique.mockResolvedValue({email:'user@example.test'});
	mocks.ensureUserLedger.mockResolvedValue({id:'real-usd-ledger',currency:'USD'});
	mocks.ensureSystemAccount.mockResolvedValue({id:'verified-btc-clearing',currency:'USD'});
	mocks.postDoubleEntry.mockResolvedValue(undefined);
	mocks.balance.mockResolvedValue(new Prisma.Decimal('12.00'));
	mocks.roundUsdAmount.mockImplementation((value:number|string)=>new Prisma.Decimal(value).toDecimalPlaces(2,Prisma.Decimal.ROUND_HALF_UP));
	mocks.createNotification.mockResolvedValue(undefined);
	mocks.sendSupportEmail.mockResolvedValue({sent:false,reason:'not-configured'});
});

describe('admin REAL BTC deposit review route',()=>{
	it('refuses a wallet credit until the BTC request is manually verified',async()=>{
		const response=await PATCH(reviewRequest('APPROVED',{note:'Reviewed receipt',creditedAmount:42}));
		expect(response.status).toBe(409);
		expect(await response.json()).toMatchObject({error:'Manually verify the Bitcoin transaction and receipt before approving a wallet credit.'});
		expect(mocks.postDoubleEntry).not.toHaveBeenCalled();
	});

	it('rejects a BTC request without crediting funds and records rejection rather than approval',async()=>{
		const response=await PATCH(reviewRequest('REJECTED',{note:'Evidence did not match'}));
		expect(response.status).toBe(200);
		expect(currentFunding.status).toBe(FundingStatus.REJECTED);
		expect(currentFunding.creditedAmount).toBeNull();
		expect(mocks.postDoubleEntry).not.toHaveBeenCalled();
		expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({action:'BTC_DEPOSIT_REJECTED'})}));
	});

	it('records verification separately, then credits the REAL USD ledger once on explicit approval',async()=>{
		const verification=await PATCH(reviewRequest('VERIFIED',{note:'Checked tx on explorer'}));
		expect(verification.status).toBe(200);
		expect(currentFunding.verifiedAt).toBeInstanceOf(Date);
		expect(currentFunding.status).toBe(FundingStatus.PENDING_REVIEW);
		expect(mocks.postDoubleEntry).not.toHaveBeenCalled();
		expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({action:'BTC_DEPOSIT_MANUALLY_VERIFIED'})}));

		const approval=await PATCH(reviewRequest('APPROVED',{note:'Verified transaction and amount',creditedAmount:42.5}));
		const approvedBody=await approval.json();
		expect(approval.status).toBe(200);
		expect(currentFunding).toMatchObject({status:FundingStatus.APPROVED,creditedCurrency:'USD',creditedAmount:new Prisma.Decimal('42.5')});
		expect(mocks.ensureUserLedger).toHaveBeenCalledWith(tx,'user-1',AccountMode.REAL,'USD');
		expect(mocks.postDoubleEntry).toHaveBeenCalledTimes(1);
		expect(mocks.postDoubleEntry).toHaveBeenCalledWith(tx,expect.objectContaining({
			reference:`FUNDING:${transactionId}:APPROVED`,
			amount:new Prisma.Decimal('42.5'),
		}));
		expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({action:'BTC_DEPOSIT_APPROVED'})}));
		expect(mocks.createNotification).toHaveBeenCalledTimes(2);
		expect(approvedBody).toMatchObject({creditedCurrency:'USD',accountMode:AccountMode.REAL});

		const replay=await PATCH(reviewRequest('APPROVED',{note:'Duplicate approval attempt',creditedAmount:42.5}));
		expect(replay.status).toBe(409);
		expect(mocks.postDoubleEntry).toHaveBeenCalledTimes(1);
	});

	it('approves a REAL withdrawal without marking it completed or debiting the ledger',async()=>{
		currentFunding={
			...currentFunding,
			type:FundingType.WITHDRAWAL,
			method:'Internal simulated withdrawal',
			amount:new Prisma.Decimal('10.00'),
			currency:'USD',
			network:null,
			transactionReference:null,
			status:FundingStatus.PENDING_REVIEW,
			receiptKey:null,
		};
		tx.fundingRequest.aggregate.mockImplementation(async({where}:{where:{type:FundingType;status:FundingStatus|{in:FundingStatus[]}}})=>{
			if(where.type===FundingType.DEPOSIT)return {_sum:{creditedAmount:new Prisma.Decimal('100.00'),amount:null}};
			if(where.status===FundingStatus.COMPLETED)return {_sum:{amount:new Prisma.Decimal(0),creditedAmount:null}};
			return {_sum:{amount:new Prisma.Decimal(0),creditedAmount:null}};
		});
		const response=await PATCH(reviewRequest('APPROVED',{note:'Verified eligible source'}));
		const body=await response.json();
		expect(response.status).toBe(200);
		expect(body).toMatchObject({status:FundingStatus.APPROVED,settledAt:null,settlementReference:null});
		expect(mocks.postDoubleEntry).not.toHaveBeenCalled();
		expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({metadata:expect.objectContaining({resultingBalance:'12'})})}));
		expect(mocks.createNotification).toHaveBeenCalledWith(tx,expect.objectContaining({message:expect.stringContaining('external payout provider is not configured')}));
	});
});

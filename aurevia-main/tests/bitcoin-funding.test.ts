import {Prisma} from '@prisma/client';
import {describe,expect,it} from 'vitest';
import {assertPaperBuyCollateral,normalizeBitcoinTransactionId,paperOrderCollateral,validateBitcoinDepositAmount} from '@/lib/bitcoin-funding';

describe('REAL BTC deposit validation',()=>{
	it('normalizes only 64-character hexadecimal transaction IDs',()=>{
		expect(normalizeBitcoinTransactionId(`  ${'A'.repeat(64)} `)).toBe('a'.repeat(64));
		expect(normalizeBitcoinTransactionId('a'.repeat(63))).toBeNull();
		expect(normalizeBitcoinTransactionId('g'.repeat(64))).toBeNull();
	});

	it('accepts positive BTC values to eight decimals and rejects invalid precision or range',()=>{
		expect(validateBitcoinDepositAmount('0.00000001').toFixed(8)).toBe('0.00000001');
		expect(()=>validateBitcoinDepositAmount('0')).toThrow('INVALID_BTC_AMOUNT');
		expect(()=>validateBitcoinDepositAmount('0.000000001')).toThrow('INVALID_BTC_AMOUNT');
		expect(()=>validateBitcoinDepositAmount('100000001')).toThrow('INVALID_BTC_AMOUNT');
	});
});

describe('REAL wallet paper-buy collateral',()=>{
	it('reserves remaining open-buy cost and the remaining cost basis of paper holdings without profits',()=>{
		const createdAt=new Date('2026-01-01T00:00:00Z');
		const takerFee=new Prisma.Decimal('0.01');
		const result=paperOrderCollateral([
			{instrumentId:'AAPL',side:'BUY',quantity:new Prisma.Decimal(2),filledQuantity:new Prisma.Decimal(2),averageFillPrice:new Prisma.Decimal(100),providerReservedAmount:null,status:'FILLED',createdAt,takerFee},
			{instrumentId:'AAPL',side:'SELL',quantity:new Prisma.Decimal(1),filledQuantity:new Prisma.Decimal(1),averageFillPrice:new Prisma.Decimal(120),providerReservedAmount:null,status:'FILLED',createdAt:new Date(createdAt.getTime()+1000),takerFee},
			{instrumentId:'MSFT',side:'BUY',quantity:new Prisma.Decimal(2),filledQuantity:new Prisma.Decimal(1),averageFillPrice:new Prisma.Decimal(50),providerReservedAmount:new Prisma.Decimal(101),status:'PARTIALLY_FILLED',createdAt:new Date(createdAt.getTime()+2000),takerFee},
		]);
		expect(result.heldCostBasis.toFixed(2)).toBe('151.50');
		expect(result.reservedBuys.toFixed(2)).toBe('50.50');
		expect(result.committed.toFixed(2)).toBe('202.00');
	});

	it('rejects buys that exceed the internal wallet after withdrawals and prior paper reservations',()=>{
		expect(()=>assertPaperBuyCollateral(new Prisma.Decimal(500),new Prisma.Decimal(100),new Prisma.Decimal(200),new Prisma.Decimal(201))).toThrow('INSUFFICIENT_REAL_WALLET_COLLATERAL');
		expect(()=>assertPaperBuyCollateral(new Prisma.Decimal(501),new Prisma.Decimal(100),new Prisma.Decimal(200),new Prisma.Decimal(201))).not.toThrow();
	});
});

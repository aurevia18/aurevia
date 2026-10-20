import {AccountMode,Prisma} from '@prisma/client';
import {describe,expect,it,vi} from 'vitest';
import {postDoubleEntry} from '../lib/ledger';

function transactionWithAccounts(accountModes:[AccountMode,AccountMode]){
	const create=vi.fn();
	const tx={
		ledgerAccount:{
			findMany:vi.fn().mockResolvedValue([
				{id:'debit',currency:'USD',accountMode:accountModes[0]},
				{id:'credit',currency:'USD',accountMode:accountModes[1]},
			]),
		},
		ledgerTransaction:{create},
	} as unknown as Prisma.TransactionClient;
	return {tx,create};
}

describe('mode-scoped ledger transactions',()=>{
	it('records the mode on a balanced transaction and both entries',async()=>{
		const {tx,create}=transactionWithAccounts([AccountMode.REAL,AccountMode.REAL]);

		await postDoubleEntry(tx,{
			reference:'REAL:TEST:001',
			description:'Mode isolation test',
			debitAccountId:'debit',
			creditAccountId:'credit',
			amount:'25.00',
		});

		expect(create).toHaveBeenCalledWith({
			data:{
				reference:'REAL:TEST:001',
				description:'Mode isolation test',
				accountMode:AccountMode.REAL,
				entries:{
					create:[
						{accountId:'debit',accountMode:AccountMode.REAL,type:'DEBIT',amount:new Prisma.Decimal('25.00')},
						{accountId:'credit',accountMode:AccountMode.REAL,type:'CREDIT',amount:new Prisma.Decimal('25.00')},
					],
				},
			},
		});
	});

	it('rejects a transaction that would move value across account modes',async()=>{
		const {tx,create}=transactionWithAccounts([AccountMode.DEMO,AccountMode.REAL]);

		await expect(postDoubleEntry(tx,{
			reference:'CROSS_MODE:TEST:001',
			description:'Must be rejected',
			debitAccountId:'debit',
			creditAccountId:'credit',
			amount:'25.00',
		})).rejects.toThrow('LEDGER_MODE_MISMATCH');
		expect(create).not.toHaveBeenCalled();
	});
});

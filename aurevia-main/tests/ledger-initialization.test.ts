import {AccountMode,Prisma} from '@prisma/client';
import {describe,expect,it,vi} from 'vitest';
import {initializePaperAccount} from '../lib/ledger';

function makeTransaction(){
	const accounts=new Map<string,{id:string;code:string;currency:string;accountMode:AccountMode;startingBalance:Prisma.Decimal}>();
	const upsert=vi.fn(async({where,create}:{where:{code:string};create:{code:string;currency:string;accountMode:AccountMode}})=>{
		const key=where.code;
		const existing=accounts.get(key);
		if(existing)return existing;
		const account={id:key,code:create.code,currency:create.currency,accountMode:create.accountMode,startingBalance:new Prisma.Decimal(0)};
		accounts.set(key,account);
		return account;
	});
	const transactionCreate=vi.fn().mockResolvedValue({id:'ledger-tx'});
	const tx={
		ledgerAccount:{
			upsert,
			findMany:vi.fn(async()=>[...accounts.values()]),
			update:vi.fn(async({where,data}:{where:{id:string};data:{startingBalance:Prisma.Decimal}})=>{
				const account=[...accounts.values()].find(item=>item.id===where.id)!;
				account.startingBalance=data.startingBalance;
				return account;
			}),
		},
		ledgerTransaction:{
			findUnique:vi.fn().mockResolvedValue(null),
			create:transactionCreate,
		},
		auditLog:{create:vi.fn().mockResolvedValue({})},
	};
	return {tx:tx as unknown as Prisma.TransactionClient,accounts,transactionCreate};
}

describe('paper account opening balances',()=>{
	it('creates REAL accounts without posting an opening ledger credit',async()=>{
		const {tx,accounts,transactionCreate}=makeTransaction();

		await initializePaperAccount(tx,'user-real',AccountMode.REAL);

		expect(accounts.get('USER:user-real:REAL:USD')?.startingBalance.toFixed(2)).toBe('0.00');
		expect(transactionCreate).not.toHaveBeenCalled();
	});

	it('posts the $5,000 DEMO opening balance in the DEMO ledger',async()=>{
		const {tx,accounts,transactionCreate}=makeTransaction();

		await initializePaperAccount(tx,'user-demo',AccountMode.DEMO);

		expect(accounts.get('USER:user-demo:DEMO:USD')?.startingBalance.toFixed(2)).toBe('5000.00');
		expect(transactionCreate).toHaveBeenCalledWith(expect.objectContaining({
			data:expect.objectContaining({
				reference:'DEMO:STARTING_BALANCE:user-demo',
				accountMode:AccountMode.DEMO,
				entries:{create:expect.arrayContaining([
					expect.objectContaining({accountId:'USER:user-demo:DEMO:USD',accountMode:AccountMode.DEMO,type:'CREDIT',amount:new Prisma.Decimal('5000.00')}),
				])},
			}),
		}));
	});
});

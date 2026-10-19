import {Prisma} from '@prisma/client';

export function calculateAllocationPercentages<T extends {value:Prisma.Decimal}>(items:T[]){
	const total=items.reduce((sum,item)=>sum.plus(Prisma.Decimal.max(0,item.value)),new Prisma.Decimal(0));
	return items.map(item=>({...item,percentage:total.gt(0)?Prisma.Decimal.max(0,item.value).div(total).mul(100):new Prisma.Decimal(0)}));
}

export function instrumentAssetCategory(instrument:{symbol:string;baseAsset:string;quoteAsset:string}){
	const base=instrument.baseAsset.toUpperCase();
	if(base==='XAU')return 'Gold';
	if(base==='XAG')return 'Silver';
	if(['AUR','BTC','ETH','SOL','ADA','AVAX','DOGE','LINK','LTC','MATIC','SHIB','XRP'].includes(base))return 'Crypto';
	if(['EUR','GBP','JPY','CHF','CAD','AUD','NZD'].includes(base))return 'FX';
	if(instrument.symbol.toUpperCase()===base&&instrument.quoteAsset.toUpperCase()==='USD')return 'Equity';
	return 'Other';
}

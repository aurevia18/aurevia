import {NextResponse} from 'next/server';
import {z,ZodError} from 'zod';
import {requireUser} from '@/lib/auth';
import {db} from '@/lib/db';
import {rateLimit} from '@/lib/rate-limit';
import {getServerConfiguration} from '@/lib/config/env';
import {getFinnhubQuote} from '@/lib/providers/finnhub-market-data';
import type {LiveMarketAsset} from '@/lib/live-market';
import {INTERNAL_USD_REFERENCE_RATES} from '@/lib/config/internal-currency-rates';

const targets=['EUR','GBP','NGN','CAD','AUD','CHF','JPY'] as const;
const schema=z.object({to:z.enum(targets)});
const maxRateAgeMs=24*60*60_000;

export async function GET(request:Request){
	try{
		const user=await requireUser();
		rateLimit(`currency-rate:${user.id}`,30,60_000);
		const {to}=schema.parse({to:new URL(request.url).searchParams.get('to')});
		const cached=await db.exchangeRate.findUnique({where:{baseCurrency_quoteCurrency:{baseCurrency:'USD',quoteCurrency:to}}});
		const apiKey=getServerConfiguration().marketData.finnhubApiKey;
		if(apiKey){
			const asset:LiveMarketAsset={id:`USD${to}`,ticker:`USD${to}=X`,name:`US Dollar / ${to}`,type:'FOREX',currency:to};
			let quote:Awaited<ReturnType<typeof getFinnhubQuote>>|null=null;
			try{
				quote=await getFinnhubQuote(asset,apiKey);
			}catch(error){
				console.warn(`Currency-rate provider unavailable (${error instanceof Error?error.name:'UnknownError'}).`);
			}
			if(quote){
				const observedAt=new Date(quote.updatedAt);
				if(Number.isFinite(observedAt.getTime())&&observedAt.getTime()<=Date.now()+5_000&&Date.now()-observedAt.getTime()<=maxRateAgeMs){
					const stored=await db.exchangeRate.upsert({
						where:{baseCurrency_quoteCurrency:{baseCurrency:'USD',quoteCurrency:to}},
						create:{baseCurrency:'USD',quoteCurrency:to,rate:quote.price,source:quote.source,observedAt},
						update:{rate:quote.price,source:quote.source,observedAt},
						select:{rate:true,source:true,observedAt:true},
					});
					return NextResponse.json({baseCurrency:'USD',quoteCurrency:to,rate:stored.rate,source:stored.source,observedAt:stored.observedAt,status:'CURRENT'},{headers:{'Cache-Control':'private, no-store'}});
				}
			}
		}
		if(cached&&Number(cached.rate)>0&&Number.isFinite(Number(cached.rate))){
			const age=Date.now()-cached.observedAt.getTime();
			const current=Number.isFinite(age)&&age>=-5_000&&age<=maxRateAgeMs;
			return NextResponse.json({baseCurrency:'USD',quoteCurrency:to,rate:cached.rate,source:cached.source,observedAt:cached.observedAt,status:current?'CURRENT':'STALE'},{headers:{'Cache-Control':'private, no-store'}});
		}
		const rate=INTERNAL_USD_REFERENCE_RATES[to];
		if(rate===undefined)throw new Error(`Internal reference rate is not configured for ${to}.`);
		return NextResponse.json({baseCurrency:'USD',quoteCurrency:to,rate,source:'Aurevia internal reference rate',observedAt:null,status:'INTERNAL'},{headers:{'Cache-Control':'private, no-store'}});
	}catch(error){
		if(error instanceof ZodError)return NextResponse.json({error:'Unsupported display currency.'},{status:400});
		if(error instanceof Error&&error.message==='UNAUTHORIZED')return NextResponse.json({error:'Unauthorized'},{status:401});
		if(error instanceof Error&&error.message==='RATE_LIMITED')return NextResponse.json({error:'Currency-rate requests are temporarily limited.'},{status:429});
		return NextResponse.json({error:'Currency rates are temporarily unavailable.'},{status:503});
	}
}

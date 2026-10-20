import {NextResponse} from 'next/server';
import {requireUser} from '@/lib/auth';
import {db} from '@/lib/db';
import {SUPPORTED_CURRENCIES} from '@/lib/config/simulation';
import {isBitcoinMainnetAddress,SIMULATED_BTC_ADDRESS_SETTING} from '@/lib/config/simulated-bitcoin-address';

export const dynamic='force-dynamic';

export async function GET(){
	try{
		await requireUser();
		const addressSetting=await db.systemSetting.findUnique({where:{key:SIMULATED_BTC_ADDRESS_SETTING},select:{value:true}});
		const address=addressSetting?.value.trim()||'';
		const configuredAddress=address&&isBitcoinMainnetAddress(address)?address:null;
		return NextResponse.json({
			methods:[],
			fundingStatus:configuredAddress?'MANUAL_REVIEW':'NOT_CONFIGURED',
			simulationAvailable:true,
			supportedCurrencies:SUPPORTED_CURRENCIES,
			simulatedBitcoinAddress:configuredAddress,
			realFundingAvailable:!!configuredAddress,
			realWithdrawalAvailable:true,
			manualDepositReviewAvailable:!!configuredAddress,
			externalPaymentProcessing:'DISABLED',
		},{headers:{'Cache-Control':'private, no-store'}});
	}catch(error){
		if(error instanceof Error&&error.message==='UNAUTHORIZED')return NextResponse.json({error:'Unauthorized'},{status:401});
		return NextResponse.json({error:'Funding requests are temporarily unavailable.'},{status:503,headers:{'Cache-Control':'private, no-store'}});
	}
}
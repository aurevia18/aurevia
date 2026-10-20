import {NextResponse} from 'next/server';
import {requireUser} from '@/lib/auth';
import {db} from '@/lib/db';
import {SUPPORTED_CURRENCIES} from '@/lib/config/simulation';

export const dynamic='force-dynamic';

export async function GET(){
	try{
		const user=await requireUser();
		const currentUser=await db.user.findUnique({where:{id:user.id},select:{accountMode:true,status:true}});
		if(!currentUser||currentUser.status!=='ACTIVE')return NextResponse.json({error:'Funding options are unavailable.'},{status:403});
		if(currentUser.accountMode==='DEMO')return NextResponse.json({
			methods:[],
			fundingStatus:'DISABLED',
			simulationAvailable:true,
			supportedCurrencies:SUPPORTED_CURRENCIES,
			simulatedBitcoinAddress:null,
			realFundingAvailable:false,
			realWithdrawalAvailable:false,
			manualDepositReviewAvailable:false,
			externalPaymentProcessing:'DISABLED',
		},{headers:{'Cache-Control':'private, no-store'}});
		return NextResponse.json({
			methods:[],
			fundingStatus:'AVAILABLE',
			simulationAvailable:true,
			supportedCurrencies:SUPPORTED_CURRENCIES,
			simulatedBitcoinAddress:null,
			realFundingAvailable:true,
			realWithdrawalAvailable:true,
			manualDepositReviewAvailable:true,
			externalPaymentProcessing:'DISABLED',
			internalLedgerOnly:true,
		},{headers:{'Cache-Control':'private, no-store'}});
	}catch(error){
		if(error instanceof Error&&error.message==='UNAUTHORIZED')return NextResponse.json({error:'Unauthorized'},{status:401});
		return NextResponse.json({error:'Funding requests are temporarily unavailable.'},{status:503,headers:{'Cache-Control':'private, no-store'}});
	}
}
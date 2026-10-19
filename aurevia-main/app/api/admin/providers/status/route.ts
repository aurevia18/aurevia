import {NextResponse} from 'next/server';
import {requireAdmin} from '@/lib/auth';
import {getLiveMarketProviderStatus} from '@/lib/live-market';
import {getServerConfiguration} from '@/lib/config/env';
import {getInternalSimulationHealth} from '@/lib/providers/simulation-health';
import {getAlpacaPaperAccountHealth} from '@/lib/providers/alpaca-crypto-provider';

export const dynamic='force-dynamic';

export async function GET(){
	try{
		await requireAdmin();
		const [health,marketProvider,alpacaPaperAccount]=await Promise.all([
			getInternalSimulationHealth(true),
			getLiveMarketProviderStatus(getServerConfiguration().marketData.finnhubApiKey),
			getAlpacaPaperAccountHealth(),
		]);
		return NextResponse.json({
			checkedAt:health.checkedAt,
			internalSimulation:health,
			alpacaPaperAccount,
			marketData:{
				status:marketProvider.status,
				provider:marketProvider.provider,
				finnhubStatus:marketProvider.finnhubStatus,
				fallbackProvider:marketProvider.fallbackProvider,
				usedForOrderExecution:false,
			},
			identity:{status:'ADMIN_REVIEW_ONLY',adminReviewAvailable:'AVAILABLE',externalVerification:'DISABLED'},
		},{headers:{'Cache-Control':'private, no-store'}});
	}catch(error){
		const status=error instanceof Error&&error.message==='UNAUTHORIZED'?401:403;
		return NextResponse.json({error:status===401?'Unauthorized':'Forbidden'},{status});
	}
}
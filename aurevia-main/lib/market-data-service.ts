import {getMarketHistory,getMarketQuote,type LiveMarketAsset,type TimeframeId} from '@/lib/live-market';
import {getInternalMarketHistory,getInternalMarketQuote} from '@/lib/internal-market-data';

export async function getMarketQuoteWithFallback(asset:LiveMarketAsset,apiKey:string){
	if(!apiKey)return getInternalMarketQuote(asset);
	try{
		const quote=await getMarketQuote(asset,apiKey);
		if(!quote.isStale)return quote;
		console.warn('Finnhub quote is stale; using internal market data.');
		return getInternalMarketQuote(asset);
	}
	catch(error){
		console.warn(`Finnhub quote unavailable; using internal market data (${error instanceof Error?error.name:'UnknownError'}).`);
		return getInternalMarketQuote(asset);
	}
}

export async function getMarketHistoryWithFallback(asset:LiveMarketAsset,timeframe:TimeframeId,apiKey:string){
	if(!apiKey)return getInternalMarketHistory(asset,timeframe);
	try{
		const history=await getMarketHistory(asset,timeframe,apiKey);
		if(!history.quote.isStale)return history;
		console.warn('Finnhub history quote is stale; using internal market data.');
		return getInternalMarketHistory(asset,timeframe);
	}
	catch(error){
		console.warn(`Finnhub history unavailable; using internal market data (${error instanceof Error?error.name:'UnknownError'}).`);
		return getInternalMarketHistory(asset,timeframe);
	}
}

import type {SupportedCurrency} from '@/lib/config/simulation';

export const INTERNAL_USD_REFERENCE_RATES:Partial<Record<SupportedCurrency,number>>={
	EUR:0.92,
	GBP:0.79,
	NGN:1600,
	CAD:1.37,
	AUD:1.52,
	CHF:0.88,
	JPY:149,
};

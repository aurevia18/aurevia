export const SUPPORTED_CURRENCIES=['USD','EUR','GBP','NGN','CAD','AUD','CHF','JPY'] as const;
export type SupportedCurrency=(typeof SUPPORTED_CURRENCIES)[number];
export const SIMULATION_BASE_CURRENCY:SupportedCurrency='USD';
export const DEMO_OPENING_BALANCE='5000.00';
export const REAL_OPENING_BALANCE='0.00';
export const PAPER_OPENING_BALANCE=DEMO_OPENING_BALANCE;
export const EXTERNAL_FINANCIAL_OPERATIONS_ENABLED=false;
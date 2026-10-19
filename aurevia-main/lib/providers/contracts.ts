export type ProviderOrderState='ACCEPTED'|'PARTIALLY_FILLED'|'FILLED'|'REJECTED'|'CANCELLED'|'FAILED';

export type ProviderOrderRequest={
	clientOrderId:string;
	accountId:string;
	symbol:string;
	assetId?:string;
	side:'BUY'|'SELL';
	type:'MARKET'|'LIMIT'|'STOP'|'STOP_LIMIT';
	quantity:string;
	timeInForce?:'day'|'gtc'|'ioc';
	limitPrice?:string;
	stopPrice?:string;
};

export type ProviderExecution={
	executionId:string;
	quantity:string;
	price:string;
	fee:string;
	currency:string;
	executedAt:string;
};

export type ProviderOrder={
	providerOrderId:string;
	clientOrderId:string;
	state:ProviderOrderState;
	providerStatus?:string;
	acceptedAt:string;
	updatedAt:string;
	executions:ProviderExecution[];
	filledQuantity?:string;
	averageFillPrice?:string;
};

export type ProviderPosition={
	symbol:string;
	quantity:string;
	averagePrice:string;
	marketValue?:string;
	unrealizedPnl?:string;
	currency:string;
	asOf:string;
};

export type ProviderBalance={
	currency:string;
	available:string;
	reserved:string;
	asOf:string;
};

export type ProviderReconciliation={
	startedAt:string;
	completedAt:string;
	matchedOrders:number;
	mismatchedOrders:number;
	matchedPositions:number;
	mismatchedPositions:number;
	differences:Array<{entity:'ORDER'|'POSITION'|'BALANCE';providerReference:string;reason:string}>;
};

export type SignedProviderWebhook={
	eventId:string;
	eventType:string;
	providerOrderId:string;
	occurredAt:string;
};

export interface ExecutionProvider{
	readonly name:string;
	readonly executionMode:'PAPER'|'LIVE';
	healthCheck():Promise<{connected:boolean;checkedAt:string;status?:'AUTHENTICATION_FAILED'|'UNAVAILABLE'}>;
	submitOrder(request:ProviderOrderRequest,idempotencyKey:string):Promise<ProviderOrder>;
	cancelOrder(providerOrderId:string,idempotencyKey:string):Promise<ProviderOrder>;
	getOrderStatus(providerOrderId:string):Promise<ProviderOrder>;
	getPositions(accountId:string):Promise<ProviderPosition[]>;
	getBalances(accountId:string):Promise<ProviderBalance[]>;
	reconcile(accountId:string):Promise<ProviderReconciliation>;
	verifyWebhook(rawBody:string,signature:string):Promise<boolean>;
	parseWebhook(rawBody:string):Promise<SignedProviderWebhook>;
}

export type MarketQuote={
	symbol:string;
	price:number|null;
	bid:number|null;
	ask:number|null;
	open:number|null;
	high:number|null;
	low:number|null;
	previousClose:number|null;
	volume:number|null;
	marketStatus:'OPEN'|'CLOSED'|'PREMARKET'|'AFTER_HOURS'|'UNKNOWN';
	source:string;
	asOf:string;
};

export type MarketBar={time:string;open:number;high:number;low:number;close:number;volume:number|null};

export interface MarketDataProvider{
	readonly name:string;
	getQuote(symbol:string):Promise<MarketQuote>;
	getBars(symbol:string,from:string,to:string,interval:string):Promise<MarketBar[]>;
	healthCheck():Promise<{connected:boolean;checkedAt:string}>;
}

export type IdentityVerificationRequest={userId:string;legalName:string;dateOfBirth:string;documentReferences:string[]};
export type IdentityVerificationResult={providerReference:string;status:'PENDING'|'APPROVED'|'REJECTED'|'NEEDS_REVIEW';checkedAt:string};

export interface IdentityComplianceProvider{
	readonly name:string;
	verifyIdentity(request:IdentityVerificationRequest,idempotencyKey:string):Promise<IdentityVerificationResult>;
	checkSanctions(userId:string,idempotencyKey:string):Promise<{providerReference:string;clear:boolean;checkedAt:string}>;
	healthCheck():Promise<{connected:boolean;checkedAt:string}>;
}

export interface FundingProvider{
	readonly name:string;
	verifyDeposit(reference:string):Promise<{confirmed:boolean;providerReference:string;amount:string;currency:string;confirmedAt:string}>;
	submitWithdrawal(request:{userId:string;amount:string;currency:string;destinationReference:string},idempotencyKey:string):Promise<{providerReference:string;status:'PENDING'|'COMPLETED'|'FAILED';submittedAt:string}>;
	getWithdrawalStatus(providerReference:string):Promise<{status:'PENDING'|'COMPLETED'|'FAILED';updatedAt:string}>;
	verifyWebhook(rawBody:string,signature:string):Promise<boolean>;
	healthCheck():Promise<{connected:boolean;checkedAt:string}>;
}

export type ProviderConnectionState='NOT_CONFIGURED'|'CONFIGURED'|'CONNECTED'|'ERROR'|'DISABLED';
export type AlpacaMode='PAPER'|'LIVE';
export type AlpacaAccountSummary={
  accountId:string;
  status:string;
  currency:string;
  cash:string;
  buyingPower:string;
  equity:string;
  portfolioValue:string;
  patternDayTrader:boolean;
  tradeSuspendedByUser:boolean;
};
export type AlpacaQuote={
  symbol:string;
  bid:number|null;
  ask:number|null;
  last:number|null;
  asOf:string;
};
export type AlpacaOrderFill={
  price:string;
  quantity:string;
  timestamp:string;
};
export type AlpacaOrderForm={
  symbol:string;
  qty:string;
  side:'buy'|'sell';
  type:'market'|'limit'|'stop';
  time_in_force?:'day'|'gtc'|'ioc';
  limit_price?:string;
  stop_price?:string;
};

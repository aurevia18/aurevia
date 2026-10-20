import {NextResponse} from 'next/server';
import {FundingType,Prisma} from '@prisma/client';
import {z,ZodError} from 'zod';
import {getServerSession} from 'next-auth';
import {authOptions} from '@/lib/auth-options';
import {db} from '@/lib/db';
import {balance,reservedWithdrawalAmount} from '@/lib/ledger';
import {getAccountTier} from '@/lib/production-policy';
import {MARKET_ASSETS} from '@/lib/live-market';
import {getMarketQuoteWithFallback} from '@/lib/market-data-service';
import {getServerConfiguration} from '@/lib/config/env';
import {getSupportContact} from '@/lib/config';
import {calculateTradePlan,formatTradePlan,hasDemoOrderIntent,missingTradePlanInputs,parseDemoOrderIntent,parseTradePlan,requestsUnsupportedOrderType} from '@/lib/nova-assistant';
import {rateLimit} from '@/lib/rate-limit';
import {isIP} from 'node:net';

const schema=z.object({question:z.string().trim().min(1).max(800),conversationId:z.string().uuid().optional()});

function clientIp(request:Request){
	const forwarded=request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()||'';
	const real=request.headers.get('x-real-ip')?.trim()||'';
	return forwarded&&isIP(forwarded)?forwarded:real&&isIP(real)?real:'unknown';
}

const education:[RegExp,string][]=[
	[/\b(etf|exchange.traded fund)\b/i,'An ETF is a fund that trades on an exchange and may hold a basket of assets. Its price can move during the trading day and it carries the risks of its underlying holdings.'],
	[/\b(bid.ask|spread)\b/i,'The bid is the highest displayed price a buyer is offering and the ask is the lowest displayed price a seller is offering. The spread is the difference; it may widen when liquidity is lower.'],
	[/\b(volume|liquidity)\b/i,'Volume is the amount traded over a stated period. Liquidity describes how readily an asset can be traded without materially affecting its price; volume alone does not guarantee liquidity.'],
	[/\b(volatility)\b/i,'Volatility describes how much an asset price varies over time. Higher volatility can increase both potential gains and losses; it does not predict the direction of the next move.'],
	[/\b(diversif|portfolio)\b/i,'Diversification spreads exposure across different holdings and risk sources. It can reduce concentration risk, but does not remove market risk or guarantee a return.'],
	[/\b(position size|sizing|risk.re.?ward|stop.loss|take.profit)\b/i,'Position size should reflect a defined risk budget and the distance between the entry and exit levels. Stop-loss and take-profit orders have execution risks and do not guarantee a specific fill price. I can explain the math, but this is not a recommendation.'],
	[/\b(limit order|market order|order type)\b/i,'A market order seeks execution at the best available prices, which may differ from the last quote. A limit order specifies a maximum buy price or minimum sell price and may not execute. Review the order details in Trade before submitting.'],
	[/\b(order status|filled|execution)\b/i,'Order status comes from the order history and the execution provider. A submitted or open order is not a fill; check the order details for the recorded provider status. Nova does not claim execution independently.'],
	[/\b(stock|share|equity)\b/i,'A stock represents an ownership interest in a company. Its market price can change rapidly and there is no guaranteed return. For current instrument details, ask about a symbol and I will check available provider data.'],
	[/\b(risk management|risk)\b/i,'Risk management includes limiting concentration, choosing a position size consistent with a loss budget, and understanding that prices can gap or liquidity can change. No control guarantees against loss.'],
];

export async function POST(request:Request){
	try{
		const input=schema.parse(await request.json());
		const session=await getServerSession(authOptions);
		const userId=session?.user?.id;
		rateLimit(userId?`nova-user:${userId}`:`nova-ip:${clientIp(request)}`,30,60_000);
		const orderIntent=parseDemoOrderIntent(input.question);
		const orderIntentRequested=hasDemoOrderIntent(input.question);
		let orderDraft:{instrumentId:string;symbol:string;side:'BUY'|'SELL';type:'MARKET';quantity:number;expectedPrice:number;observedAt:string;estimatedValue:number;accountMode:'DEMO'}|undefined;
		let orderAnswer:string|undefined;
		if(orderIntentRequested){
			if(requestsUnsupportedOrderType(input.question)){
				orderAnswer='Nova can currently prepare DEMO market-order previews only. Limit and stop orders are not prepared here; review their conditions in Trade. No order has been created.';
			}else if(!orderIntent){
				orderAnswer='To prepare a DEMO market-order preview, specify exactly a side, positive quantity, and listed symbol—for example, “prepare demo order: buy 2 AAPL”. No order has been created.';
			}else if(!userId){
				orderAnswer='Sign in to prepare an order preview. No order has been created.';
			}else{
				const user=await db.user.findUnique({where:{id:userId},select:{accountMode:true}});
				if(user?.accountMode!=='DEMO'){
					orderAnswer='Nova order preparation is available only in DEMO mode. REAL trading is not available through Nova; use Trade only if the verified REAL execution workflow is enabled. No order has been created.';
				}else{
					const instrument=await db.instrument.findFirst({where:{symbol:orderIntent.symbol,enabled:true},select:{id:true,symbol:true,price:true}});
					if(!instrument){
						orderAnswer=`${orderIntent.symbol} is not an enabled instrument in the DEMO market. No order has been created. Open Markets to check the available symbols.`;
					}else if(orderIntent.side==='SELL'){
						const [position,reservations]=await Promise.all([
							db.position.aggregate({where:{userId,instrumentId:instrument.id,accountMode:'DEMO',status:'OPEN',side:'BUY'},_sum:{quantity:true}}),
							db.order.aggregate({where:{userId,instrumentId:instrument.id,accountMode:'DEMO',side:'SELL',status:'OPEN'},_sum:{quantity:true}}),
						]);
						const sellable=Number(position._sum.quantity||0)-Number(reservations._sum.quantity||0);
						if(sellable<orderIntent.quantity){
							orderAnswer=`The requested ${orderIntent.quantity} ${instrument.symbol} exceeds your available DEMO sell quantity${sellable>0?` of ${sellable}`:''}. No order has been created.`;
						}else{
							const expectedPrice=Number(instrument.price);
							if(!Number.isFinite(expectedPrice)||expectedPrice<=0){
								orderAnswer=`A valid DEMO reference price is unavailable for ${instrument.symbol}. No order has been created.`;
							}else{
								const observedAt=new Date().toISOString();
								orderDraft={instrumentId:instrument.id,symbol:instrument.symbol,side:orderIntent.side,type:'MARKET',quantity:orderIntent.quantity,expectedPrice,observedAt,estimatedValue:Number((expectedPrice*orderIntent.quantity).toFixed(6)),accountMode:'DEMO'};
								orderAnswer=`I prepared a DEMO-only market order preview for ${orderIntent.side} ${orderIntent.quantity} ${instrument.symbol} at the current simulated reference price. Estimated notional: ${orderDraft.estimatedValue}. This is simulated, the price can change before submission, and the order is not placed until you explicitly confirm below.`;
								await db.auditLog.create({data:{actorId:userId,action:'NOVA_DEMO_ORDER_PREPARED',entity:'NOVA_ACTIVITY',entityId:input.conversationId||null,metadata:{eventTypes:['DEMO_ORDER_PREPARED'],accountMode:'DEMO',symbol:instrument.symbol,externalAction:false,providerResult:'not-applicable'}}});
							}
						}
					}else{
						const expectedPrice=Number(instrument.price);
						if(!Number.isFinite(expectedPrice)||expectedPrice<=0){
							orderAnswer=`A valid DEMO reference price is unavailable for ${instrument.symbol}. No order has been created.`;
						}else{
							const observedAt=new Date().toISOString();
							orderDraft={instrumentId:instrument.id,symbol:instrument.symbol,side:orderIntent.side,type:'MARKET',quantity:orderIntent.quantity,expectedPrice,observedAt,estimatedValue:Number((expectedPrice*orderIntent.quantity).toFixed(6)),accountMode:'DEMO'};
							orderAnswer=`I prepared a DEMO-only market order preview for ${orderIntent.side} ${orderIntent.quantity} ${instrument.symbol} at the current simulated reference price. Estimated notional: ${orderDraft.estimatedValue}. This is simulated, the price can change before submission, and the order is not placed until you explicitly confirm below.`;
							await db.auditLog.create({data:{actorId:userId,action:'NOVA_DEMO_ORDER_PREPARED',entity:'NOVA_ACTIVITY',entityId:input.conversationId||null,metadata:{eventTypes:['DEMO_ORDER_PREPARED'],accountMode:'DEMO',symbol:instrument.symbol,externalAction:false,providerResult:'not-applicable'}}});
						}
					}
				}
			}
		}
		const normalized=input.question.toUpperCase();
		const asset=MARKET_ASSETS.find(item=>new RegExp(`(^|[^A-Z0-9])${item.id.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}([^A-Z0-9]|$)`).test(normalized));
		let quoteAnswer:string|undefined;
		let quoteAudit:Record<string,string|boolean>|undefined;
		if(asset&&/\b(price|quote|market|movement|trading at|value|ticker)\b/i.test(input.question)){
			try{
				const config=getServerConfiguration();
				const quote=await getMarketQuoteWithFallback(asset,config.marketData.finnhubApiKey);
				const ageMinutes=Math.max(0,Math.round((Date.now()-Date.parse(quote.updatedAt))/60_000));
				const freshness=quote.source==='Finnhub'?(quote.isStale||ageMinutes>5?'STALE FINNHUB DATA':'FINNHUB DATA'):'INTERNAL PAPER-MARKET DATA';
				quoteAnswer=`${asset.name} (${asset.id}): ${quote.price} ${asset.currency}; daily change ${quote.change} (${quote.changePercent}%). Source: ${quote.source}. Timestamp: ${quote.updatedAt}. Status: ${freshness}. This is market information, not a trade recommendation.`;
				quoteAudit={symbol:asset.id,source:quote.source,freshness:quote.isStale?'STALE':'UNVERIFIED',updatedAt:quote.updatedAt,externalAction:false,providerResult:'quote-returned'};
			}catch{
				quoteAnswer=`I could not retrieve provider market data for ${asset.id} right now. No price is available to report; try again later or open Markets for its current status.`;
				quoteAudit={symbol:asset.id,freshness:'UNAVAILABLE',externalAction:false,providerResult:'unavailable'};
			}
		}
		let accountAnswer:string|undefined;
		let auditAction:string|undefined;
		let tradePlanAnswer:string|undefined;
		if(/\b(position size|position sizing|calculate (?:my )?(?:position )?size|risk.reward|risk to reward)\b/i.test(input.question)){
			const parsed=parseTradePlan(input.question);
			const plan=parsed?calculateTradePlan(parsed):null;
			tradePlanAnswer=plan?formatTradePlan(plan):missingTradePlanInputs(input.question);
			if(userId&&plan){
				await db.auditLog.create({data:{actorId:userId,action:'NOVA_TRADE_PLAN_CALCULATED',entity:'NOVA_ACTIVITY',entityId:input.conversationId||null,metadata:{eventTypes:['TRADE_PLAN_CALCULATED'],accountMode:session?.user?.accountMode==='REAL'?'REAL':'DEMO',externalAction:false,providerResult:'not-applicable'}}});
				auditAction='trade-plan-calculation';
			}
		}
		if(userId&&/\b(i|my|mine|account|balance|wallet|portfolio|positions?|holdings?|orders?|trades?|investments?|watchlists?|tickets?|tiers?|kyc|verification|notifications?|deposits?|withdrawals?|payments?)\b/i.test(input.question)){
			const user=await db.user.findUnique({where:{id:userId},select:{id:true,accountMode:true,approvedTier:true,kycStatus:true,kyc:{select:{submittedAt:true}},kycDocuments:{where:{kind:'IDENTITY_DOCUMENT',status:'APPROVED'},select:{id:true}}}});
			if(user){
				const requested=input.question.toLowerCase();
				const answers:string[]=[];
				const eventTypes:string[]=[];
				if(/\b(balance|wallet)\b/.test(requested)){
					const ledger=await db.ledgerAccount.findUnique({where:{code:`USER:${user.id}:${user.accountMode}:USD`},select:{id:true}});
					if(ledger){
						const [current,reserved]=await Promise.all([balance(db,ledger.id),reservedWithdrawalAmount(db,user.id,user.accountMode,'USD')]);
						const available=Prisma.Decimal.max(new Prisma.Decimal(0),current.minus(reserved));
						answers.push(`${user.accountMode} USD ledger balance: ${current.toString()} USD. Pending withdrawals reserve ${reserved.toString()} USD, leaving ${available.toString()} USD available before other account restrictions. Pending deposits are not included until approved. This is simulated ledger data.`);
					}
					else answers.push(`No ${user.accountMode} USD ledger account is available to report.`);
					eventTypes.push('WALLET_BALANCE_LOOKUP');
				}
				if(/\bportfolio|positions?|holdings?\b/.test(requested)){
					const [openPositionCount,positions]=await Promise.all([
						db.position.count({where:{userId:user.id,accountMode:user.accountMode,status:'OPEN'}}),
						db.position.findMany({where:{userId:user.id,accountMode:user.accountMode,status:'OPEN'},include:{instrument:{select:{symbol:true,price:true,updatedAt:true}}},orderBy:{openedAt:'desc'},take:5}),
					]);
					const holdings=positions.map(position=>{
						const mark=new Prisma.Decimal(position.instrument.price);
						const difference=position.side==='BUY'?mark.minus(position.entryPrice):position.entryPrice.minus(mark);
						const unrealized=difference.mul(position.quantity);
						return `${position.side} ${position.quantity.toString()} ${position.instrument.symbol} at entry ${position.entryPrice.toString()}, latest stored simulated mark ${mark.toString()}, unrealized mark-to-market ${unrealized.toString()} USD (price updated ${position.instrument.updatedAt.toISOString()})`;
					}).join('; ');
					answers.push(`${user.accountMode} account has ${openPositionCount} open position${openPositionCount===1?'':'s'}${holdings?`. Latest records: ${holdings}`:'. No open positions are recorded.'} Mark-to-market figures are estimates from stored simulated prices, not realized profit or external valuations.`);
					eventTypes.push('PORTFOLIO_SUMMARY_LOOKUP');
				}
				if(/\b(orders?|trades?|execution|fill)\b/.test(requested)){
					const [orderCount,orders]=await Promise.all([
						db.order.count({where:{userId:user.id,accountMode:user.accountMode}}),
						db.order.findMany({where:{userId:user.id,accountMode:user.accountMode},orderBy:{createdAt:'desc'},take:5,select:{id:true,side:true,type:true,status:true,quantity:true,filledQuantity:true,providerStatus:true,updatedAt:true,instrument:{select:{symbol:true}}}}),
					]);
					const recent=orders.map(order=>`${order.side} ${order.quantity.toString()} ${order.instrument.symbol} ${order.type} · ${order.status}${order.providerStatus?` (provider: ${order.providerStatus})`:''}${order.filledQuantity.gt(0)?` · recorded filled quantity ${order.filledQuantity.toString()}`:''}`).join('; ');
					answers.push(`${user.accountMode} order history contains ${orderCount} record${orderCount===1?'':'s'}${recent?`. Latest orders: ${recent}`:''}. A request is not a fill; only the stored execution/provider status is reported.`);
					eventTypes.push('ORDER_HISTORY_LOOKUP');
				}
				if(/\binvestments?\b/.test(requested)){
					const eligibility=user.accountMode==='DEMO'?{demoEligible:true}:{realEligible:true};
					const [count,investments,opportunities]=await Promise.all([
						db.investmentRequest.count({where:{userId:user.id,accountMode:user.accountMode}}),
						db.investmentRequest.findMany({where:{userId:user.id,accountMode:user.accountMode},orderBy:{requestedAt:'desc'},take:5,select:{amount:true,status:true,requestedAt:true,activatedAt:true,maturesAt:true,simulatedPayout:true,opportunity:{select:{title:true}}}}),
						db.investmentOpportunity.findMany({where:{status:'AVAILABLE',...eligibility},orderBy:{createdAt:'desc'},take:5,select:{title:true,minimumAmount:true,durationDays:true,targetReturnPercent:true}}),
					]);
					const recent=investments.map(item=>`${item.opportunity.title}: ${item.amount.toString()} USD · ${item.status.replaceAll('_',' ')}${item.maturesAt?` · matures ${item.maturesAt.toISOString()}`:''}${item.status==='SETTLED'&&item.simulatedPayout?` · virtual payout ${item.simulatedPayout.toString()} USD`:''}`).join('; ');
					const plans=opportunities.map(item=>`${item.title} · minimum ${item.minimumAmount.toString()} USD · ${item.durationDays} days${item.targetReturnPercent===null?'':` · configured simulation target ${item.targetReturnPercent.toString()}%`}`).join('; ');
					answers.push(`Your ${user.accountMode} account has ${count} simulated investment request${count===1?'':'s'}${recent?`. Recent activity: ${recent}`:'. No investment requests are recorded.'}${plans?` Available simulated plans: ${plans}.`:''} Any configured target and payout are virtual simulation results, not guaranteed or external investment returns.`);
					eventTypes.push('INVESTMENT_CONTEXT_LOOKUP');
				}
				if(/\bwatchlist\b/.test(requested)){
					answers.push('I cannot read a saved watchlist from the server in this session. Open Markets to review the watchlist saved for this device and account.');
					eventTypes.push('WATCHLIST_SOURCE_UNAVAILABLE');
				}
				if(/\btiers?\b/.test(requested)){
					const tier=getAccountTier({accountMode:user.accountMode,kycStatus:user.kycStatus,verificationDocuments:user.kycDocuments.length,verificationSubmitted:!!user.kyc?.submittedAt,approvedTier:user.approvedTier});
					answers.push(`Current account tier: ${tier.label}. Tier approval does not enable REAL trading.`);
					eventTypes.push('TIER_STATUS_LOOKUP');
				}
				if(/\bkyc|verification\b/.test(requested)){
					answers.push(`Recorded identity review status: ${user.kycStatus}; identity profile submitted: ${user.kyc?.submittedAt?'yes':'no'}; approved identity documents on file: ${user.kycDocuments.length}. Nova cannot approve identity checks.`);
					eventTypes.push('KYC_STATUS_LOOKUP');
				}
				if(/\btickets?\b/.test(requested)){
					const tickets=await db.supportConversation.count({where:{userId:user.id,accountMode:user.accountMode,status:{notIn:['RESOLVED','CLOSED']}}});
					answers.push(`You have ${tickets} support ticket${tickets===1?'':'s'} currently open in this account mode. Your full ticket history is available in Support.`);
					eventTypes.push('SUPPORT_STATUS_LOOKUP');
				}
				if(/\bnotifications?\b/.test(requested)){
					const unread=await db.notification.count({where:{userId:user.id,isRead:false}});
					answers.push(`You have ${unread} unread notification${unread===1?'':'s'}. Open Notifications to review them.`);
					eventTypes.push('NOTIFICATION_SUMMARY_LOOKUP');
				}
				if(/\b(deposits?|withdrawals?|payments?|payouts?)\b/.test(requested)){
					const requests=await db.fundingRequest.findMany({where:{userId:user.id,accountMode:user.accountMode,type:{in:[FundingType.DEPOSIT,FundingType.WITHDRAWAL]}},orderBy:{createdAt:'desc'},take:5,select:{type:true,status:true,amount:true,currency:true}});
					const recent=requests.map(item=>`${item.type.toLowerCase()} ${item.amount.toString()} ${item.currency} · ${item.status.toLowerCase().replaceAll('_',' ')}`).join('; ');
					answers.push(`Your ${user.accountMode} account supports internal simulated deposit and withdrawal requests in Wallet. ${recent?`Recent requests: ${recent}.`:'No funding requests are recorded.'} An authorized Aurevia administrator reviews requests and any ledger changes; no payment provider, bank, broker, or crypto network is contacted. A request or evidence attachment is not proof of a real payment.`);
					eventTypes.push('PAYMENT_INSTRUCTIONS_LOOKUP');
				}
				accountAnswer=answers.join(' ');
				if(eventTypes.length)await db.auditLog.create({data:{actorId:user.id,action:'NOVA_USER_CONTEXT_LOOKUP',entity:'NOVA_ACTIVITY',entityId:input.conversationId||null,metadata:{eventTypes,accountMode:user.accountMode,externalAction:false}}});
				auditAction=eventTypes.length?'account-context':undefined;
			}
		}
		if(userId&&quoteAudit)await db.auditLog.create({data:{actorId:userId,action:'NOVA_MARKET_DATA_LOOKUP',entity:'NOVA_ACTIVITY',entityId:input.conversationId||null,metadata:quoteAudit}});
		const contact=getSupportContact();
		const fixed=education.find(([pattern])=>pattern.test(input.question))?.[1];
		const answer=orderAnswer||tradePlanAnswer||quoteAnswer||accountAnswer||fixed||(/\b(support|contact|email)\b/i.test(input.question)?`Official Aurevia support email: ${contact.email}. You can also create a private support ticket from this page.`:/\b(deposit|payment|bitcoin|bank)\b/i.test(input.question)?'Open Wallet to submit an internal simulated deposit or withdrawal request for administrator review. No external payment destination or transfer is provided.':/\b(real|demo|trade|order)\b/i.test(input.question)?'DEMO and REAL-interface orders use separate internal simulated ledgers and simulated execution. Market data availability is separate; no broker orders are submitted. Nova cannot submit orders.':'I can explain platform workflows, common investing terms, and supported market quotes. For account-specific questions, sign in; for market data, include a symbol. I do not execute trades or confirm payments.');
		return NextResponse.json({answer,...(orderDraft?{orderDraft}:{}),activity:auditAction||quoteAudit||orderDraft?'recorded-without-conversation-content':'none'},{headers:{'Cache-Control':'private, no-store'}});
	}catch(error){
		if(error instanceof ZodError)return NextResponse.json({error:'Ask a question of at most 800 characters.'},{status:400});
		if(error instanceof Error&&error.message==='RATE_LIMITED')return NextResponse.json({error:'Nova requests are temporarily rate limited. Try again shortly.'},{status:429});
		if(error instanceof Error&&error.message==='UNAUTHORIZED')return NextResponse.json({error:'Sign in to ask account-specific questions.'},{status:401});
		console.error('Nova request failed.');
		return NextResponse.json({error:'Nova is temporarily unavailable.'},{status:503,headers:{'Cache-Control':'private, no-store'}});
	}
}

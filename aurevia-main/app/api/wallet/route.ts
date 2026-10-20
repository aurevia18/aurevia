import {NextResponse} from 'next/server';
import {AccountMode,Prisma,FundingStatus,FundingType,NotificationType} from '@prisma/client';
import {z,ZodError} from 'zod';
import {requireUser} from '@/lib/auth';
import {db} from '@/lib/db';
import {balance,ensureUserLedger,roundUsdAmount} from '@/lib/ledger';
import {jsonSafe} from '@/lib/serializers';
import {createNotification} from '@/lib/notifications';
import {notifyActiveAdmins} from '@/lib/notifications';
import {sendSupportEmail} from '@/lib/email';
import {validateWithdrawal} from '@/lib/production-policy';
import {FundingEvidenceError,maxFundingEvidenceBytes,validateFundingEvidence} from '@/lib/funding-evidence';
import {createPrivateObjectKey,deletePrivateObject,PrivateStorageError,uploadPrivateObject} from '@/lib/private-storage';
import {getRealWithdrawableBalance} from '@/lib/real-withdrawals';

const schema=z.object({
	type:z.nativeEnum(FundingType),
	paymentMethodId:z.string().min(1).optional(),
	amount:z.number().positive().max(100000000),
	currency:z.literal('USD'),
	transactionReference:z.string().trim().max(180).optional(),
	referenceInfo:z.string().trim().max(500).optional(),
	senderInfo:z.string().trim().max(300).optional(),
	destinationInfo:z.string().trim().max(500).optional(),
	beneficiaryInfo:z.string().trim().max(300).optional(),
	network:z.string().trim().max(80).optional(),
	note:z.string().trim().max(500).optional(),
});

const reservingStatuses=[FundingStatus.PENDING,FundingStatus.PENDING_REVIEW,FundingStatus.APPROVED,FundingStatus.PROCESSING];

export async function GET(){
	try{
		const user=await requireUser();
		const currentUser=await db.user.findUnique({where:{id:user.id},select:{accountMode:true,status:true}});
		if(!currentUser||currentUser.status!=='ACTIVE')return NextResponse.json({error:'Wallet account is unavailable.'},{status:403});
		await ensureUserLedger(db,user.id,currentUser.accountMode,'USD');
		const [accounts,transactions]=await Promise.all([
			db.ledgerAccount.findMany({where:{userId:user.id,accountMode:currentUser.accountMode},orderBy:{currency:'asc'}}),
			db.fundingRequest.findMany({where:{userId:user.id,accountMode:currentUser.accountMode},orderBy:{createdAt:'desc'},take:100,include:{paymentMethod:{select:{id:true,name:true}},user:{select:{name:true,email:true}}}}),
		]);
		const balances=await Promise.all(accounts.map(async account=>({currency:account.currency,balance:await balance(db,account.id)})));
		const usdBalance=balances.find(item=>item.currency==='USD')?.balance??null;
		const withdrawableBalance=currentUser.accountMode===AccountMode.REAL
			?await getRealWithdrawableBalance(db,user.id,usdBalance??new Prisma.Decimal(0))
			:null;
		const accountIds=accounts.map(account=>account.id);
		const adminLedgerTransactions=accountIds.length?await db.ledgerTransaction.findMany({
			where:{reference:{startsWith:`ADMIN:${currentUser.accountMode}:${user.id}:`},entries:{some:{accountId:{in:accountIds}}}},
			orderBy:{createdAt:'desc'},
			take:100,
			include:{entries:{where:{accountId:{in:accountIds}},select:{type:true,amount:true,account:{select:{currency:true}}}}},
		}):[];
		const adminLedgerReceipts=adminLedgerTransactions.flatMap(transaction=>{
			const entry=transaction.entries[0];
			return entry?[{id:transaction.id,reference:transaction.reference,description:transaction.description,type:entry.type,amount:entry.amount,currency:entry.account.currency,createdAt:transaction.createdAt}]:[];
		});
		const approvals=transactions.length?await db.auditLog.findMany({where:{entity:'FUNDING',entityId:{in:transactions.map(transaction=>transaction.id)},action:{in:['FUNDING_APPROVED','BTC_DEPOSIT_APPROVED']}},select:{entityId:true,createdAt:true,metadata:true,actor:{select:{name:true,email:true}}},orderBy:{createdAt:'desc'}}):[];
		const approvalByRequest=new Map();
		for(const approval of approvals)if(approval.entityId&&!approvalByRequest.has(approval.entityId)){
			const metadata=approval.metadata&&typeof approval.metadata==='object'&&!Array.isArray(approval.metadata)?approval.metadata as Record<string,unknown>:{};
			approvalByRequest.set(approval.entityId,{reviewedAt:approval.createdAt,reviewedBy:approval.actor,previousBalance:typeof metadata.previousBalance==='string'?metadata.previousBalance:null,resultingBalance:typeof metadata.resultingBalance==='string'?metadata.resultingBalance:null});
		}
		const safeTransactions=transactions.map(({receiptKey,...transaction})=>({...transaction,hasReceipt:!!receiptKey,...(approvalByRequest.get(transaction.id)||{})}));
		return NextResponse.json(jsonSafe({accountMode:currentUser.accountMode,balance:usdBalance,withdrawableBalance,balances,transactions:safeTransactions,adminLedgerReceipts}),{headers:{'Cache-Control':'private, no-store'}});
	}catch(error){
		if(error instanceof Error&&error.message==='UNAUTHORIZED')return NextResponse.json({error:'Unauthorized'},{status:401});
		const code=error&&typeof error==='object'&&'code' in error?String(error.code):'';
		console.error(`Wallet data unavailable (${/^[A-Z0-9_]{2,32}$/.test(code)?code:error instanceof Error?error.name:'UnknownError'}).`);
		return NextResponse.json({error:'Wallet data is temporarily unavailable.'},{status:503,headers:{'Cache-Control':'private, no-store'}});
	}
}

export async function POST(req:Request){
	let receiptKey:string|undefined;
	let ownerId:string|undefined;
	let evidenceMetadata:{fileType:string;fileSize:number}|undefined;
	try{
		const user=await requireUser();
		ownerId=user.id;
		const currentUser=await db.user.findUnique({where:{id:user.id},select:{accountMode:true,status:true,depositEnabled:true,withdrawalEnabled:true,accountRestricted:true}});
		if(!currentUser||currentUser.status!=='ACTIVE')return NextResponse.json({error:'Wallet account is unavailable.'},{status:403});
		if(currentUser.accountMode===AccountMode.DEMO)return NextResponse.json({error:'Deposits and withdrawals are available in REAL Mode only.'},{status:403});
		let body:unknown;
		let evidenceFile:File|null=null;
		if(req.headers.get('content-type')?.includes('multipart/form-data')){
			if(Number(req.headers.get('content-length')||0)>maxFundingEvidenceBytes+64*1024)return NextResponse.json({error:'Evidence must be 5 MB or smaller.'},{status:413});
			const form=await req.formData();
			const payload=form.get('payload');
			if(typeof payload!=='string')return NextResponse.json({error:'Funding details are required.'},{status:400});
			try{body=JSON.parse(payload)}catch{return NextResponse.json({error:'Funding details are invalid.'},{status:400})}
			const file=form.get('evidence');
			if(file instanceof File)evidenceFile=file;
		}else{
			body=await req.json();
		}
		const parsed=schema.parse(body);
		const idempotencyKey=req.headers.get('Idempotency-Key');
		if(!idempotencyKey||idempotencyKey.length>128)return NextResponse.json({error:'A valid idempotency key is required.'},{status:400});
		if(parsed.type===FundingType.DEPOSIT){
			if(!currentUser.depositEnabled)throw new Error('DEPOSITS_DISABLED');
		}
		if(parsed.paymentMethodId)return NextResponse.json({error:'External payment methods are disabled. Submit an internal Aurevia ledger request without a payment method.'},{status:400});
		if(parsed.type===FundingType.DEPOSIT&&evidenceFile){
			if(evidenceFile.size===0)throw new FundingEvidenceError('Choose a non-empty evidence file.',400);
			if(evidenceFile.size>maxFundingEvidenceBytes)throw new FundingEvidenceError('Evidence must be 5 MB or smaller.',413);
			const bytes=Buffer.from(await evidenceFile.arrayBuffer());
			const {contentType}=validateFundingEvidence(evidenceFile,bytes,{imagesOnly:true});
			evidenceMetadata={fileType:contentType,fileSize:bytes.length};
			receiptKey=createPrivateObjectKey('receipt',user.id,contentType);
			await uploadPrivateObject('receipt',user.id,receiptKey,bytes,contentType);
		}
		if(parsed.type==='WITHDRAWAL'){
			if(!currentUser.withdrawalEnabled)throw new Error('WITHDRAWAL_DISABLED');
			if(currentUser.accountRestricted)throw new Error('ACCOUNT_RESTRICTED');
		}
		const currency='USD';
		const amount=roundUsdAmount(parsed.amount);
		if(amount.lte(0))throw new Error('INVALID_AMOUNT');
		const transactionReference=parsed.transactionReference||null;

		const result=await db.$transaction(async tx=>{
			const activeUser=await tx.user.findUnique({where:{id:user.id},select:{accountMode:true,status:true}});
			if(!activeUser||activeUser.status!=='ACTIVE')throw new Error('WALLET_ACCOUNT_UNAVAILABLE');
			if(activeUser.accountMode!==currentUser.accountMode)throw new Error('ACCOUNT_MODE_CHANGED');
			const duplicate=await tx.fundingRequest.findUnique({where:{idempotencyKey}});
			if(duplicate){
				if(duplicate.userId!==user.id||duplicate.accountMode!==currentUser.accountMode||duplicate.type!==parsed.type||!duplicate.amount.equals(amount)||duplicate.currency!==currency||duplicate.paymentMethodId!==null||duplicate.transactionReference!==transactionReference)throw new Error('IDEMPOTENCY_KEY_REUSED');
				return {request:duplicate,replay:true};
			}
			const fundingUser=await tx.user.findUniqueOrThrow({where:{id:user.id},select:{kycStatus:true,depositEnabled:true,withdrawalEnabled:true,accountRestricted:true,kyc:{select:{submittedAt:true}},kycDocuments:{where:{kind:'IDENTITY_DOCUMENT',status:'APPROVED'},select:{id:true}}}});
			if(parsed.type==='DEPOSIT'&&!fundingUser.depositEnabled)throw new Error('DEPOSITS_DISABLED');
			if(parsed.type==='WITHDRAWAL'&&!fundingUser.withdrawalEnabled)throw new Error('WITHDRAWAL_DISABLED');
			if(parsed.type==='DEPOSIT'&&(fundingUser.kycStatus!=='APPROVED'||!fundingUser.kyc?.submittedAt||fundingUser.kycDocuments.length===0))throw new Error('REAL_KYC_REQUIRED');
			if(parsed.type==='WITHDRAWAL'&&fundingUser.accountRestricted)throw new Error('ACCOUNT_RESTRICTED');
			if(parsed.type==='WITHDRAWAL'){
				const account=await ensureUserLedger(tx,user.id,currentUser.accountMode,currency);
				const currentBalance=await balance(tx,account.id);
				const pending=await tx.fundingRequest.aggregate({where:{userId:user.id,accountMode:currentUser.accountMode,currency,type:FundingType.WITHDRAWAL,status:{in:reservingStatuses}},_sum:{amount:true}});
				const reserved=pending._sum.amount??new Prisma.Decimal(0);
				if(currentUser.accountMode==='REAL')validateWithdrawal({balance:currentBalance.toString(),pending:reserved.toString(),amount:amount.toString(),withdrawalEnabled:fundingUser.withdrawalEnabled,accountRestricted:fundingUser.accountRestricted,kycStatus:fundingUser.kycStatus,simulated:true});
				else if(currentBalance.lt(amount.plus(reserved)))throw new Error('INSUFFICIENT_AVAILABLE_BALANCE');
				if(currentUser.accountMode==='REAL'){
					const withdrawable=await getRealWithdrawableBalance(tx,user.id,currentBalance);
					if(withdrawable.lt(amount))throw new Error('INSUFFICIENT_AVAILABLE_BALANCE');
				}
			}
			const request=await tx.fundingRequest.create({data:{
				userId:user.id,
				type:parsed.type,
				method:`Internal REAL ${parsed.type.toLowerCase()} request`,
				amount,
				currency,
				status:FundingStatus.PENDING_REVIEW,
				accountMode:currentUser.accountMode,
				paymentMethodId:null,
				idempotencyKey,
				transactionReference,
				referenceInfo:parsed.referenceInfo||null,
				senderInfo:parsed.senderInfo||null,
				destinationInfo:null,
				beneficiaryInfo:null,
				network:null,
				note:parsed.note||null,
				receiptKey:receiptKey||null,
			}});
			await tx.auditLog.create({data:{actorId:user.id,action:'FUNDING_SUBMITTED',entity:'FUNDING',entityId:request.id,metadata:{type:request.type,accountMode:request.accountMode,currency:request.currency,amount:request.amount.toString(),hasEvidence:!!receiptKey,transactionReference,externalEvidenceUserSubmitted:!!receiptKey||!!transactionReference}}});
			if(receiptKey)await tx.auditLog.create({data:{actorId:user.id,action:'PAYMENT_RECEIPT_UPLOADED',entity:'FUNDING',entityId:request.id,metadata:{accountMode:request.accountMode,...evidenceMetadata}}});
			const notificationType=request.type===FundingType.DEPOSIT?NotificationType.DEPOSIT:NotificationType.WITHDRAWAL;
			await createNotification(tx,{userId:user.id,type:notificationType,title:`REAL ${request.type.toLowerCase()} request submitted`,message:'Your request is pending administrator review. This is an internal Aurevia ledger request; no external payment or transfer is initiated, and your balance will change only after approval.',dedupeKey:`funding:${request.id}:submitted`,relatedEntity:'FUNDING',relatedId:request.id,actionUrl:`/wallet/transactions/${request.id}`});
			await notifyActiveAdmins(tx,{type:notificationType,title:`New REAL ${request.type.toLowerCase()} request`,message:`A REAL account ${request.type.toLowerCase()} request for ${request.amount.toFixed(2)} USD awaits administrator review. Any attached file or reference is user-submitted information only; no external payment is processed.`,dedupeKey:`funding:${request.id}:admin`,relatedEntity:'FUNDING',relatedId:request.id,actionUrl:'/admin'});
			return {request,replay:false};
		},{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,maxWait:5_000,timeout:15_000});
		if(result.replay&&receiptKey)await deletePrivateObject('receipt',user.id,receiptKey);
		const {receiptKey:storedReceiptKey,...safeRequest}=result.request;
		receiptKey=undefined;
		let emailDelivery:'sent'|'not-configured'|'failed'='not-configured';
		if(!result.replay){
			const delivery=await sendSupportEmail(`New internal ${result.request.type.toLowerCase()} request`,[`Request: ${result.request.id}`,`User: ${user.id}`,`Account mode: ${result.request.accountMode}`,`Amount: ${result.request.amount.toString()} ${result.request.currency}`,`Status: ${result.request.status}`].join('\n'));
			emailDelivery=delivery.sent?'sent':delivery.reason||'failed';
		}
		return NextResponse.json({...jsonSafe(safeRequest),hasReceipt:!!storedReceiptKey,emailDelivery},{status:result.replay?200:201});
	}catch(error){
		if(receiptKey&&ownerId)await deletePrivateObject('receipt',ownerId,receiptKey);
		if(error instanceof ZodError)return NextResponse.json({error:'Funding requests must use USD. Check the request details and try again.'},{status:400});
		if(error instanceof FundingEvidenceError)return NextResponse.json({error:error.message},{status:error.status});
		if(error instanceof PrivateStorageError)return NextResponse.json({error:error.message},{status:error.status});
		if(error instanceof Prisma.PrismaClientKnownRequestError&&error.code==='P2002')return NextResponse.json({error:'This submission was already received.'},{status:409});
		if(error instanceof Error&&error.message==='ACCOUNT_MODE_CHANGED')return NextResponse.json({error:'Your active account mode changed. Refresh and submit the request again.'},{status:409});
		if(error instanceof Error&&error.message==='WALLET_ACCOUNT_UNAVAILABLE')return NextResponse.json({error:'Wallet account is unavailable.'},{status:403});
		if(error&&typeof error==='object'&&'code'in error&&String(error.code)==='P2034')return NextResponse.json({error:'The account changed while submitting this request. Refresh and try again.'},{status:409});
		const known=['IDEMPOTENCY_KEY_REUSED','PAYMENT_METHOD_UNAVAILABLE','AMOUNT_OUT_OF_RANGE','PAYMENT_INSTRUCTIONS_UNAVAILABLE','WITHDRAWAL_DESTINATION_REQUIRED','WITHDRAWAL_NETWORK_REQUIRED','INSUFFICIENT_AVAILABLE_BALANCE','DEPOSITS_DISABLED','WITHDRAWAL_DISABLED','ACCOUNT_RESTRICTED','REAL_KYC_REQUIRED','INVALID_AMOUNT','FIRST_TRADE_REQUIRED'];
		if(error instanceof Error&&known.includes(error.message))return NextResponse.json({error:error.message.replaceAll('_',' ').toLowerCase()},{status:error.message==='IDEMPOTENCY_KEY_REUSED'?409:error.message==='DEPOSITS_DISABLED'||error.message==='ACCOUNT_RESTRICTED'||error.message==='WITHDRAWAL_DISABLED'||error.message==='REAL_KYC_REQUIRED'||error.message==='FIRST_TRADE_REQUIRED'?403:400});
		const code=error&&typeof error==='object'&&'code' in error?String(error.code):'';
		if(['P1001','P1002','P1017','P2021','P2022'].includes(code))return NextResponse.json({error:'Funding service is temporarily unavailable.'},{status:503});
		console.error(`Funding request failed (${/^[A-Z0-9_]{2,32}$/.test(code)?code:error instanceof Error?error.name:'UnknownError'}).`);
		return NextResponse.json({error:'Unable to submit this funding request.'},{status:500});
	}
}
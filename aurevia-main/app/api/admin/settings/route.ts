import {NextResponse} from 'next/server';
import {z,ZodError} from 'zod';
import {requireAdmin} from '@/lib/auth';
import {db} from '@/lib/db';
import {isBitcoinMainnetAddress,SIMULATED_BTC_ADDRESS_SETTING} from '@/lib/config/simulated-bitcoin-address';
import {tierBoostSettingKeys} from '@/lib/tier-boost-settings';

const schema=z.object({key:z.string().min(1).max(100),value:z.string().max(500)});
const tierBoostKeys=new Set<string>(Object.values(tierBoostSettingKeys));

export async function GET(){
	try{
		await requireAdmin();
		return NextResponse.json(await db.systemSetting.findMany({orderBy:{key:'asc'}}),{headers:{'Cache-Control':'private, no-store'}});
	}catch(error){
		const status=error instanceof Error&&error.message==='UNAUTHORIZED'?401:error instanceof Error&&error.message==='FORBIDDEN'?403:503;
		return NextResponse.json({error:status===401?'Unauthorized':status===403?'Forbidden':'Unable to load system settings.'},{status});
	}
}

export async function PUT(request:Request){
	try{
		const admin=await requireAdmin();
		const input=schema.parse(await request.json());
		const value=input.value.trim();
		if(input.key===SIMULATED_BTC_ADDRESS_SETTING&&value&&!isBitcoinMainnetAddress(value)){
			return NextResponse.json({error:'Enter a valid Bitcoin mainnet address or leave it blank to remove the display address.'},{status:400});
		}
		if(tierBoostKeys.has(input.key)){
			const percentage=Number(value);
			if(!/^\d{1,4}(?:\.\d{1,4})?$/.test(value)||!Number.isFinite(percentage)||percentage>1000){
				return NextResponse.json({error:'Enter a simulated earning boost from 0 to 1000 percent, with up to four decimal places.'},{status:400});
			}
		}
		const setting=await db.$transaction(async tx=>{
			const updated=await tx.systemSetting.upsert({where:{key:input.key},update:{value},create:{key:input.key,value}});
			await tx.auditLog.create({data:{actorId:admin.id,action:'SETTING_UPDATE',entity:'SYSTEM_SETTING',entityId:input.key,metadata:{key:input.key,value:input.key===SIMULATED_BTC_ADDRESS_SETTING?'[display address updated]':value}}});
			return updated;
		});
		return NextResponse.json(setting,{headers:{'Cache-Control':'private, no-store'}});
	}catch(error){
		if(error instanceof ZodError)return NextResponse.json({error:'Enter a valid setting key and value.'},{status:400});
		if(error instanceof Error&&error.message==='UNAUTHORIZED')return NextResponse.json({error:'Unauthorized'},{status:401});
		if(error instanceof Error&&error.message==='FORBIDDEN')return NextResponse.json({error:'Forbidden'},{status:403});
		console.error('Administrator system setting update failed.',error instanceof Error?error.name:'UnknownError');
		return NextResponse.json({error:'Unable to save this system setting.'},{status:503});
	}
}

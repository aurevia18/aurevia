import {Prisma} from '@prisma/client';
import {tierBoostSettingKeys} from '@/lib/tier-boost-settings';

export async function configuredTierBoost(tx:Prisma.TransactionClient,approvedTier:number){
	if(approvedTier<2)return new Prisma.Decimal(0);
	const settingKey=approvedTier>=3?tierBoostSettingKeys[3]:tierBoostSettingKeys[2];
	const setting=await tx.systemSetting.findUnique({where:{key:settingKey},select:{value:true}});
	const boost=new Prisma.Decimal(setting?.value||'0');
	if(!boost.isFinite()||boost.lt(0)||boost.gt(1000))throw new Error('INVALID_TIER_BOOST_SETTING');
	return boost;
}

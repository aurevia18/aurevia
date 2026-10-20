import {PrismaClient,Role,UserStatus} from '@prisma/client';
import bcrypt from 'bcryptjs';
const db=new PrismaClient();
async function main(){
 const email=process.env.ADMIN_EMAIL?.trim().toLowerCase();
 const password=process.env.ADMIN_PASSWORD;
 const username=process.env.ADMIN_USERNAME?.trim();
 if(!email||!password||!username)throw new Error('Set ADMIN_USERNAME, ADMIN_EMAIL, and ADMIN_PASSWORD before seeding the administrator.');
 if(password.length<12)throw new Error('ADMIN_PASSWORD must contain at least 12 characters.');
 const hash=await bcrypt.hash(password,12);
 const existingUser=await db.user.findUnique({where:{email},select:{id:true,role:true}});
 const existingAdmin=await db.user.findFirst({where:{role:Role.ADMIN},select:{id:true}});
 if(existingUser&&existingUser.role!==Role.ADMIN)throw new Error('ADMIN_EMAIL belongs to a customer account; use a dedicated administrator account.');
 if(existingUser&&existingAdmin&&existingUser.id!==existingAdmin.id)throw new Error('ADMIN_EMAIL belongs to a different account while an administrator already exists; refusing to create a duplicate administrator.');
 const admin=existingUser
  ?await db.user.update({where:{id:existingUser.id},data:{passwordHash:hash,role:Role.ADMIN,status:UserStatus.ACTIVE,name:username}})
  :existingAdmin
   ?await db.user.update({where:{id:existingAdmin.id},data:{email,passwordHash:hash,status:UserStatus.ACTIVE,name:username}})
   :await db.user.create({data:{email,passwordHash:hash,name:username,role:Role.ADMIN,status:UserStatus.ACTIVE}});
 for(const i of [{symbol:'AUR/USD',name:'Aurevia Dollar',baseAsset:'AUR',quoteAsset:'USD',price:100},{symbol:'BTC/USD',name:'Bitcoin / USD',baseAsset:'BTC',quoteAsset:'USD',price:92500},{symbol:'ETH/USD',name:'Ethereum / USD',baseAsset:'ETH',quoteAsset:'USD',price:3200},{symbol:'EUR/USD',name:'Euro / US Dollar',baseAsset:'EUR',quoteAsset:'USD',price:1.08},{symbol:'NVDA',name:'NVIDIA Corporation',baseAsset:'NVDA',quoteAsset:'USD',price:140},{symbol:'XAU/USD',name:'Gold / US Dollar',baseAsset:'XAU',quoteAsset:'USD',price:2650}]) await db.instrument.upsert({where:{symbol:i.symbol},update:{},create:i});
 await db.systemSetting.upsert({where:{key:'defaultLeverage'},update:{value:'1'},create:{key:'defaultLeverage',value:'1'}});
 const clientStoryDrafts=[
  {id:'draft-rodriguez-felix',displayName:'Rodriguez Felix',cityOrRegion:'New York',country:'USA',quote:"I'm so happy to be an investor here with your platform.\nNow I've successfully gotten the apartment of my choice with the help of your great platform.\nI wasn't expecting to come across a legit platform like yours, with the experience I have trading with your company you guys are perfect real and legit and also your investment are perfect, safe and secure.\nI'm so happy to be here and same time sharing my testimony with Aurevia Investment Plc."},
  {id:'draft-john-abert',displayName:'John Abert',cityOrRegion:'California',country:'USA',quote:"This week has been a blessing for me and my siblings. How more can I thank you? You have not just introduced me to a legit platform, you have also wiped away tears and removed shame from my life. People who have laughed at me are now begging me to plug them up with your company. Your company has kept its words since the day I joined. I no longer work from 7-4 anymore. I'm my own boss now."},
  {id:'draft-brooklyn-mark',displayName:'Brooklyn Mark',cityOrRegion:'San Antonio',country:'USA',quote:"I am very grateful. To be honest it has not been easy with me and my family. Now with what I got from your platform I am going to be debt free. All thanks to you. I didn't believe I would receive my profit. Thanks. I will never give up. I am going to invest $210,070 again right away. Once again thanks very much. I got my first profits today and I'm happy."},
  {id:'draft-roland-andrew',displayName:'Roland Andrew',cityOrRegion:'Mississippi',country:'USA',quote:"Hello 👋\nI'm so happy my life changed for good. I can now take care of my family, my business is fast growing and I've been able to clear my debts and loans I took from colleagues and even from the bank. Allah is good to me for directing me to this great Aurevia company."},
 ];
 for(const story of clientStoryDrafts)await db.clientStory.upsert({where:{id:story.id},update:{},create:{...story,publicationStatus:'DRAFT',source:'User-supplied draft; identity, transaction, and consent not verified.'}});
 await db.auditLog.create({data:{actorId:admin.id,action:'SEED',entity:'SYSTEM',metadata:{message:'Initial system seed'}}});
 console.log(`Administrator provisioned for username: ${username}`);
}
main().catch(error=>{
 if(error instanceof Error&&(
  error.message.startsWith('Set ADMIN_USERNAME')||
  error.message==='ADMIN_PASSWORD must contain at least 12 characters.'||
  error.message.startsWith('ADMIN_EMAIL belongs to a different account')
  ||error.message.startsWith('ADMIN_EMAIL belongs to a customer account')
 ))console.error(error.message);
 else if(error&&typeof error==='object'&&'code' in error)console.error(`Database seed failed with error code ${String(error.code)}.`);
 else console.error('Database seed failed. Check database connectivity and required environment variables.');
 process.exitCode=1;
}).finally(()=>db.$disconnect());

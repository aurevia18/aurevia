import {NextResponse} from 'next/server';
import {Prisma} from '@prisma/client';
import {z,ZodError} from 'zod';
import {requireUser} from '@/lib/auth';
import {db} from '@/lib/db';
import {closeSimulatedPositionTx} from '@/lib/orders';
import {jsonSafe} from '@/lib/serializers';

const closeSchema=z.object({positionId:z.string().min(1)});

export async function GET(){
 try{
  const user=await requireUser();
  const currentUser=await db.user.findUnique({where:{id:user.id},select:{accountMode:true,status:true}});
  if(!currentUser||currentUser.status!=='ACTIVE')return NextResponse.json({error:'This account is unavailable.'},{status:403});
  const positions=await db.position.findMany({where:{userId:user.id,accountMode:currentUser.accountMode,status:'OPEN'},include:{instrument:true},orderBy:{openedAt:'desc'}});
  return NextResponse.json(jsonSafe(positions.map(position=>{
   const currentPrice=position.instrument.price;
   const marketValue=currentPrice.mul(position.quantity);
   const direction=position.side==='BUY'?1:-1;
   const unrealizedPnl=position.entryPrice.mul(-direction).plus(currentPrice.mul(direction)).mul(position.quantity);
   return {...position,currentPrice,marketValue,unrealizedPnl};
  })),{headers:{'Cache-Control':'private, no-store'}});
 }catch(error){
  return NextResponse.json({error:error instanceof Error&&error.message==='UNAUTHORIZED'?'Unauthorized':'Unable to load positions.'},{status:error instanceof Error&&error.message==='UNAUTHORIZED'?401:503});
 }
}

export async function POST(request:Request){
 try{
  const user=await requireUser();
  const {positionId}=closeSchema.parse(await request.json());
  const currentUser=await db.user.findUnique({where:{id:user.id},select:{accountMode:true,status:true}});
  if(!currentUser||currentUser.status!=='ACTIVE')return NextResponse.json({error:'This account is unavailable.'},{status:403});
  const closed=await db.$transaction(tx=>closeSimulatedPositionTx(tx,user.id,positionId,user.id,currentUser.accountMode),{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,maxWait:5_000,timeout:15_000});
  return NextResponse.json(jsonSafe(closed));
 }catch(error){
  if(error instanceof ZodError)return NextResponse.json({error:'Invalid position.'},{status:400});
  if(error instanceof Error&&error.message==='UNAUTHORIZED')return NextResponse.json({error:'Unauthorized'},{status:401});
  if(error instanceof Error&&error.message==='POSITION_NOT_FOUND')return NextResponse.json({error:'Open simulated position not found.'},{status:404});
  return NextResponse.json({error:error instanceof Error?error.message:'Close failed'},{status:400});
 }
}

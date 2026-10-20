import {NextResponse} from 'next/server';
import {NotificationType} from '@prisma/client';
import {requireUser} from '@/lib/auth';
import {db} from '@/lib/db';
import {createNotification} from '@/lib/notifications';
import {createPrivateObjectKey,createPrivateSignedUrl,deletePrivateObject,hasMatchingFileExtension,PrivateStorageError,uploadPrivateObject} from '@/lib/private-storage';
import {isProfileLocked} from '@/lib/profile-lock';

const maxBytes=2*1024*1024;
function avatarMime(bytes:Buffer):'image/png'|'image/jpeg'|'image/webp'|null{
	if(bytes.length>=8&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'image/png';
	if(bytes.length>=3&&bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff)return 'image/jpeg';
	if(bytes.length>=12&&bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP')return 'image/webp';
	return null;
}

export async function GET(){
	try{
		const user=await requireUser();
		const profile=await db.user.findUnique({where:{id:user.id},select:{avatarKey:true}});
		if(!profile?.avatarKey)return NextResponse.json({error:'No profile photo is configured.'},{status:404});
		return NextResponse.json({url:await createPrivateSignedUrl('avatar',user.id,profile.avatarKey)},{headers:{'Cache-Control':'private, no-store'}});
	}catch(error){
		if(error instanceof Error&&error.message==='UNAUTHORIZED')return NextResponse.json({error:'Unauthorized'},{status:401});
		if(error instanceof Error&&error.message==='FORBIDDEN')return NextResponse.json({error:'Forbidden'},{status:403});
		if(error instanceof PrivateStorageError)return NextResponse.json({error:error.message},{status:error.status});
		return NextResponse.json({error:'Profile photo is unavailable.'},{status:503});
	}
}

export async function POST(request:Request){
	let newKey:string|undefined;
	let ownerId:string|undefined;
	try{
		const user=await requireUser();
		ownerId=user.id;
		const contentLength=Number(request.headers.get('content-length')||0);
		if(contentLength>maxBytes+64*1024)return NextResponse.json({error:'Profile photo must be 2 MB or smaller.'},{status:413});
		const form=await request.formData();
		const file=form.get('file');
		if(!(file instanceof File)||file.size===0||file.size>maxBytes)return NextResponse.json({error:'Choose an image no larger than 2 MB.'},{status:400});
		const bytes=Buffer.from(await file.arrayBuffer());
		const contentType=avatarMime(bytes);
		if(!contentType||contentType!==file.type||!hasMatchingFileExtension(file.name,contentType))return NextResponse.json({error:'Profile photos must be valid PNG, JPEG, or WebP images with a matching extension.'},{status:415});
		const avatarKey=createPrivateObjectKey('avatar',user.id,contentType);
		newKey=avatarKey;
		const previous=await db.user.findUnique({where:{id:user.id},select:{avatarKey:true,verifiedAt:true,kycStatus:true}});
		if(previous?.kycStatus==='APPROVED'&&isProfileLocked(previous.verifiedAt))return NextResponse.json({error:'Verified profile details are locked. Contact support for an account change.'},{status:423});
		await uploadPrivateObject('avatar',user.id,avatarKey,bytes,contentType);
		await db.$transaction(async tx=>{
			const current=await tx.user.findUniqueOrThrow({where:{id:user.id},select:{verifiedAt:true,kycStatus:true}});
			if(current.kycStatus==='APPROVED'&&isProfileLocked(current.verifiedAt))throw new Error('PROFILE_LOCKED');
			const saved=await tx.user.updateMany({where:{id:user.id,avatarKey:previous?.avatarKey??null},data:{avatarKey}});
			if(saved.count!==1)throw new Error('AVATAR_CHANGED');
			await tx.auditLog.create({data:{actorId:user.id,action:'PROFILE_AVATAR_UPDATED',entity:'USER',entityId:user.id,metadata:{contentType,size:bytes.length}}});
			await createNotification(tx,{userId:user.id,type:NotificationType.SECURITY,title:'Profile photo updated',message:'Your profile photo was updated.',dedupeKey:`security:${user.id}:avatar:${avatarKey.split('/').at(-1)}`,actionUrl:'/settings'});
		});
		if(previous?.avatarKey)await deletePrivateObject('avatar',user.id,previous.avatarKey);
		return NextResponse.json({ok:true},{status:201});
	}catch(error){
		if(newKey&&ownerId)await deletePrivateObject('avatar',ownerId,newKey);
		if(error instanceof Error&&error.message==='UNAUTHORIZED')return NextResponse.json({error:'Unauthorized'},{status:401});
		if(error instanceof Error&&error.message==='FORBIDDEN')return NextResponse.json({error:'Forbidden'},{status:403});
		if(error instanceof Error&&error.message==='PROFILE_LOCKED')return NextResponse.json({error:'Verified profile details are locked. Contact support for an account change.'},{status:423});
		if(error instanceof Error&&error.message==='AVATAR_CHANGED')return NextResponse.json({error:'The profile photo changed. Please retry.'},{status:409});
		if(error instanceof PrivateStorageError)return NextResponse.json({error:error.message},{status:error.status});
		return NextResponse.json({error:'Profile photo upload is unavailable.'},{status:503});
	}
}
export function profileEditDeadline(verifiedAt:Date|null){
	if(!verifiedAt)return null;
	const year=verifiedAt.getUTCFullYear();
	const month=verifiedAt.getUTCMonth()+3;
	const day=verifiedAt.getUTCDate();
	const lastDay=new Date(Date.UTC(year,month+1,0)).getUTCDate();
	const deadline=new Date(verifiedAt);
	deadline.setUTCFullYear(year,month,Math.min(day,lastDay));
	return deadline;
}

export function isProfileLocked(verifiedAt:Date|null,now=new Date()){
	const deadline=profileEditDeadline(verifiedAt);
	return deadline!==null&&now>=deadline;
}

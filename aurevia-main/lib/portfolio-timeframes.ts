export type PortfolioTimeframe='1D'|'1W'|'1M'|'6M'|'1Y'|'ALL';

export type PerformanceSnapshot<T extends {snapshotBucket:string|Date}> = T;

const timeframeMilliseconds:Record<Exclude<PortfolioTimeframe,'ALL'>,number>={
	'1D':24*60*60*1000,
	'1W':7*24*60*60*1000,
	'1M':30*24*60*60*1000,
	'6M':182*24*60*60*1000,
	'1Y':365*24*60*60*1000,
};

export function filterPerformanceSnapshots<T extends PerformanceSnapshot<{snapshotBucket:string|Date}>>(
	snapshots:T[],
	timeframe:PortfolioTimeframe,
	now=new Date(),
){
	const cutoff=timeframe==='ALL'?Number.NEGATIVE_INFINITY:now.getTime()-timeframeMilliseconds[timeframe];
	return snapshots
		.filter(snapshot=>{
			const timestamp=new Date(snapshot.snapshotBucket).getTime();
			return Number.isFinite(timestamp)&&timestamp>=cutoff&&timestamp<=now.getTime();
		})
		.toSorted((left,right)=>new Date(left.snapshotBucket).getTime()-new Date(right.snapshotBucket).getTime());
}

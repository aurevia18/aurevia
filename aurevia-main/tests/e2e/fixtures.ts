import {expect,test as base,Page} from '@playwright/test';
import {randomInt} from 'node:crypto';

type RuntimeCapture={consoleErrors:string[];pageErrors:string[];failedRequests:string[];failedResponses:Array<{url:string;status:number}>};
const appOrigin='http://127.0.0.1:4310';
const credentialCallback='**/api/auth/callback/credentials**';
let loginSequence=0;

function isolatedLoginIp(){
	loginSequence+=1;
	return `198.18.${Math.floor(loginSequence/256)}.${loginSequence%256||1}`;
}

export const test=base;
export {expect};

export async function waitForStartup(page:Page){
	await expect(page.locator('.startup-screen')).toHaveCount(0);
	await expect(page.locator('.scene-content > div[inert]')).toHaveCount(0);
}

export async function loginAs(page:Page,email:string,password:string){
	const loginIp=isolatedLoginIp();
	const addIsolatedLoginIp=(route:import('@playwright/test').Route)=>route.continue({headers:{...route.request().headers(),'x-forwarded-for':loginIp}});
	const administrator=email.toLowerCase()===process.env.AUREVIA_E2E_ADMIN_EMAIL?.toLowerCase();
	await page.route(credentialCallback,addIsolatedLoginIp);
	try{
		await page.goto(administrator?'/admin/login':'/login');
		await waitForStartup(page);
		await page.getByLabel(administrator?'Admin username or email':'Email or administrator username').fill(email);
		await page.getByLabel(administrator?'Admin password':'Password',{exact:true}).fill(password);
		await page.getByRole('checkbox',{name:administrator?/Replace another active Aurevia session/:/Replace the active Aurevia session/}).check();
		await page.getByRole('button',{name:administrator?'Enter control center':'Sign in'}).click();
		await page.waitForURL(administrator?/\/admin(?:$|\/)/:/dashboard/);
		await expect.poll(async()=>{
			const response=await page.request.get('/api/auth/session');
			if(!response.ok())return null;
			const session=await response.json();
			return typeof session.user?.email==='string'?session.user.email.toLowerCase():null;
		}).toBe(email.toLowerCase());
	}finally{
		await page.unroute(credentialCallback,addIsolatedLoginIp);
	}
}

export async function logout(page:Page){
	const button=page.getByRole('banner').getByRole('button',{name:'Logout'});
	if(!await button.isVisible()){
		const menu=page.getByRole('button',{name:/Open (?:admin )?(?:navigation|menu)|Close (?:admin )?(?:navigation|menu)/});
		await expect(button.or(menu)).toBeVisible();
		if(!await button.isVisible()&&await menu.getAttribute('aria-expanded')!=='true')await menu.click();
	}
	await expect(button).toBeVisible();
	await button.click();
	await page.waitForURL(/\/login(?:\?.*)?$/);
}

export async function expectNoHorizontalOverflow(page:Page){
	const dimensions=await page.evaluate(()=>{
		const viewport=window.innerWidth;
		const offenders=[...document.querySelectorAll('body *')]
			.map(element=>{
				const rect=element.getBoundingClientRect();
				const style=getComputedStyle(element);
				return {tag:element.tagName,selector:element.id?`#${element.id}`:element.className,rect:{left:rect.left,right:rect.right,width:rect.width},position:style.position,overflow:style.overflow};
			})
			.filter(item=>item.rect.right>viewport+1||item.rect.left<-1)
			.slice(0,20);
		return {viewport,document:document.documentElement.scrollWidth,offenders};
	});
	expect(dimensions.document,`horizontal overflow at ${dimensions.viewport}px: ${JSON.stringify(dimensions.offenders)}`).toBeLessThanOrEqual(dimensions.viewport+1);
}

test.beforeEach(async({page},testInfo)=>{
	const testClientIp=`198.51.100.${randomInt(1,255)}`;
	await page.route('**/api/auth/callback/credentials**',route=>route.continue({headers:{...route.request().headers(),'x-forwarded-for':testClientIp}}));
	const capture:RuntimeCapture={consoleErrors:[],pageErrors:[],failedRequests:[],failedResponses:[]};
	(page as Page & {__runtimeCapture?:RuntimeCapture}).__runtimeCapture=capture;
	page.on('console',message=>{if(message.type()==='error'&&!message.text().includes('status of 400 (Bad Request)')&&!message.text().includes('status of 401 (Unauthorized)')&&!(testInfo.title.includes('Account Funding')&&message.text().includes('503 (Service Unavailable)')))capture.consoleErrors.push(message.text())});
	page.on('pageerror',error=>capture.pageErrors.push(error.message));
	page.on('requestfailed',request=>{
		const failure=request.failure()?.errorText||'request failed';
		if(failure==='net::ERR_ABORTED'||failure.includes('ERR_ABORTED'))return;
		if(request.url().startsWith(appOrigin))capture.failedRequests.push(`${request.method()} ${request.url()} · ${failure}`);
	});
	page.on('response',response=>{
		if(response.status()<400||!response.url().startsWith(appOrigin))return;
		capture.failedResponses.push({url:response.url(),status:response.status()});
	});
});

test.afterEach(async({page},testInfo)=>{
	const capture=(page as Page & {__runtimeCapture?:RuntimeCapture}).__runtimeCapture;
	if(!capture)return;
	await testInfo.attach('browser-runtime.json',{body:Buffer.from(JSON.stringify(capture,null,2)),contentType:'application/json'});
	const expectedClientErrors=capture.failedResponses.filter(response=>(response.url.endsWith('/api/register/verify')&&response.status===400)||(response.url.endsWith('/api/auth/callback/credentials')&&response.status===401)||((testInfo.title.includes('watchlists persist')||testInfo.title.includes('session replacement is explicit')||testInfo.title.includes('Nova escalation reaches admin')||testInfo.title.includes('tier requests require')||testInfo.title.includes('account deletion'))&&response.url.endsWith('/api/notifications?limit=8')&&response.status===401)||(testInfo.title.includes('account deletion')&&['/api/currency-preference','/api/positions'].some(path=>response.url.endsWith(path))&&response.status===401)|| (testInfo.title.includes('Nova escalation reaches admin')&&response.url.endsWith('/api/support')&&response.status===409)||(testInfo.title.includes('Account Funding')&&(response.url.endsWith('/api/payment-methods')||response.url.endsWith('/api/wallet'))&&response.status===503)||(testInfo.title.includes('KYC access is owner-scoped')&&response.url.endsWith('/api/kyc/documents')&&response.status===409));
	const unexpectedResponses=capture.failedResponses.filter(response=>!expectedClientErrors.includes(response));
	expect(capture.consoleErrors,'browser console errors').toEqual([]);
	expect(capture.pageErrors,'uncaught browser exceptions').toEqual([]);
	expect(capture.failedRequests,'failed application requests').toEqual([]);
	expect(unexpectedResponses,'unexpected failed application responses').toEqual([]);
});

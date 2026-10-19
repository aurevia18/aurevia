import {renderToStaticMarkup} from 'react-dom/server';
import {describe,expect,it} from 'vitest';
import ReceiptGenerator,{type ReceiptData} from '../components/ReceiptGenerator';

const baseReceipt:ReceiptData={
	id:'withdrawal-1',
	reference:'AUR-WITHDRAWAL-1',
	status:'APPROVED',
	type:'WITHDRAWAL',
	accountMode:'REAL',
	createdAt:'2026-10-20T12:00:00.000Z',
	name:'Test User',
	email:'user@example.test',
	amount:'25.00',
	currency:'USD',
	method:'REAL withdrawal',
};

describe('transaction receipt',()=>{
	it('does not label an approved REAL withdrawal as completed or successful',()=>{
		const markup=renderToStaticMarkup(<ReceiptGenerator receipt={baseReceipt}/>);
		expect(markup).toContain('Approved · payout not configured');
		expect(markup).not.toContain('>Success<');
		expect(markup).toContain('No external payout configured');
	});

	it('shows completion only when the persisted status is completed',()=>{
		const markup=renderToStaticMarkup(<ReceiptGenerator receipt={{...baseReceipt,status:'COMPLETED',completedAt:'2026-10-20T13:00:00.000Z'}}/>);
		expect(markup).toContain('>Completed<');
	});

	it('renders as a constrained receipt card with transaction details',()=>{
		const markup=renderToStaticMarkup(<ReceiptGenerator receipt={{...baseReceipt,status:'PENDING_REVIEW',type:'DEPOSIT',manualBitcoinDeposit:true,externalReference:'a'.repeat(64)}}/>);
		expect(markup).toContain('max-w-2xl');
		expect(markup).toContain('Transaction details');
		expect(markup).toContain('Pending review');
		expect(markup).toContain('Manual Bitcoin review · no automatic confirmation');
	});
});

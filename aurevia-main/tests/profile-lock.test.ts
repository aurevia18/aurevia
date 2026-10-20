import {describe,expect,it} from 'vitest';
import {isProfileLocked,profileEditDeadline} from '../lib/profile-lock';

describe('verified profile edit window',()=>{
	it('allows edits for three calendar months after verification',()=>{
		const verifiedAt=new Date('2026-01-20T12:00:00.000Z');
		expect(profileEditDeadline(verifiedAt)?.toISOString()).toBe('2026-04-20T12:00:00.000Z');
		expect(isProfileLocked(verifiedAt,new Date('2026-04-20T11:59:59.999Z'))).toBe(false);
		expect(isProfileLocked(verifiedAt,new Date('2026-04-20T12:00:00.000Z'))).toBe(true);
	});

	it('clamps month-end verification dates to the end of the target month',()=>{
		expect(profileEditDeadline(new Date('2026-01-31T00:00:00.000Z'))?.toISOString()).toBe('2026-04-30T00:00:00.000Z');
	});

	it('keeps accounts without a verification timestamp editable',()=>{
		expect(profileEditDeadline(null)).toBeNull();
		expect(isProfileLocked(null)).toBe(false);
	});
});

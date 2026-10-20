import {describe,expect,it} from 'vitest';
import {AccountMode,KycStatus} from '@prisma/client';
import {DEMO_STARTING_BALANCE,REAL_STARTING_BALANCE} from '../lib/ledger';
import {assertKycSubmissionAllowed,getAccountTier,validateDepositApproval,validateTierThreeApproval,validateTierUpgradeApproval,validateWithdrawal,verifyKycState} from '../lib/production-policy';

describe('production account policy',()=>{
  it('starts DEMO accounts with 5,000 virtual USD and REAL accounts with zero USD',()=>{
    expect(DEMO_STARTING_BALANCE.toFixed(2)).toBe('5000.00');
    expect(REAL_STARTING_BALANCE.toFixed(2)).toBe('0.00');
  });

  it('keeps demo and real account states isolated',()=>{
    expect(getAccountTier({accountMode:AccountMode.DEMO,kycStatus:KycStatus.APPROVED,verificationDocuments:0}).label).toBe('TIER 1');
    expect(getAccountTier({accountMode:AccountMode.REAL,kycStatus:KycStatus.PENDING,verificationDocuments:0,verificationSubmitted:true}).label).toBe('TIER 2');
    const verified=getAccountTier({accountMode:AccountMode.REAL,kycStatus:KycStatus.APPROVED,verificationDocuments:1,verificationSubmitted:true});
    expect(verified.label).toBe('TIER 3');
    expect(verified.eligibleForRealTrading).toBe(false);
    expect(getAccountTier({accountMode:AccountMode.REAL,kycStatus:KycStatus.APPROVED,verificationDocuments:1}).label).toBe('TIER 2');
  });

  it('honors an administrator-approved tier without enabling real trading',()=>{
    const approved=getAccountTier({accountMode:AccountMode.DEMO,kycStatus:KycStatus.PENDING,verificationDocuments:0,approvedTier:2});
    expect(approved.label).toBe('TIER 2');
    expect(approved.eligibleForRealTrading).toBe(false);
    expect(approved.verified).toBe(false);
  });

  it('rejects stale tier reviews and requires approved identity evidence for Tier 3',()=>{
    expect(()=>validateTierUpgradeApproval({requestCurrentTier:1,requestedTier:2,currentTier:1})).not.toThrow();
    expect(()=>validateTierUpgradeApproval({requestCurrentTier:1,requestedTier:2,currentTier:2})).toThrow('TIER_REQUEST_STALE');
    expect(()=>validateTierThreeApproval({name:'Ada User',country:'US',kycStatus:KycStatus.APPROVED,verificationSubmitted:true,approvedIdentityDocuments:1})).not.toThrow();
    expect(()=>validateTierThreeApproval({name:'Ada User',country:'US',kycStatus:KycStatus.PENDING,verificationSubmitted:true,approvedIdentityDocuments:0})).toThrow('TIER_3_REQUIREMENTS_NOT_MET');
  });

  it('rejects withdrawal when disabled, restricted, or before the first completed investment',()=>{
    expect(()=>validateWithdrawal({balance:'100',pending:'10',amount:'101',withdrawalEnabled:true,kycStatus:KycStatus.APPROVED,hasCompletedInvestment:true})).toThrow('INSUFFICIENT_BALANCE');
    expect(()=>validateWithdrawal({balance:'100',pending:'0',amount:'20',withdrawalEnabled:false,kycStatus:KycStatus.APPROVED,hasCompletedInvestment:true})).toThrow('WITHDRAWAL_DISABLED');
    expect(()=>validateWithdrawal({balance:'100',pending:'0',amount:'20',withdrawalEnabled:true,accountRestricted:true,kycStatus:KycStatus.APPROVED,hasCompletedInvestment:true})).toThrow('ACCOUNT_RESTRICTED');
    expect(()=>validateWithdrawal({balance:'100',pending:'0',amount:'20',withdrawalEnabled:true,kycStatus:KycStatus.APPROVED,hasCompletedInvestment:false})).toThrow('FIRST_TRADE_REQUIRED');
  });

  it('allows simulated REAL withdrawals without KYC or a prior investment while retaining account and balance controls',()=>{
    expect(()=>validateWithdrawal({balance:'100',pending:'10',amount:'20',withdrawalEnabled:true,kycStatus:KycStatus.PENDING,hasCompletedInvestment:false,simulated:true})).not.toThrow();
    expect(()=>validateWithdrawal({balance:'100',pending:'0',amount:'20',withdrawalEnabled:false,kycStatus:KycStatus.PENDING,simulated:true})).toThrow('WITHDRAWAL_DISABLED');
    expect(()=>validateWithdrawal({balance:'100',pending:'0',amount:'20',withdrawalEnabled:true,accountRestricted:true,kycStatus:KycStatus.PENDING,simulated:true})).toThrow('ACCOUNT_RESTRICTED');
    expect(()=>validateWithdrawal({balance:'100',pending:'10',amount:'91',withdrawalEnabled:true,kycStatus:KycStatus.PENDING,simulated:true})).toThrow('INSUFFICIENT_BALANCE');
  });

  it('requires an exact deposit credit match before approval',()=>{
    expect(()=>validateDepositApproval('100.00','90.00')).toThrow('DEPOSIT_AMOUNT_MISMATCH');
    expect(()=>validateDepositApproval('100.00','100.00')).not.toThrow();
  });

  it('only treats an approved real-account KYC state as verified',()=>{
    expect(verifyKycState(KycStatus.APPROVED)).toBe(true);
    expect(verifyKycState(KycStatus.PENDING)).toBe(false);
    expect(verifyKycState(KycStatus.REJECTED)).toBe(false);
  });

  it('prevents approved users from resubmitting KYC unless an administrator requests changes',()=>{
    expect(()=>assertKycSubmissionAllowed(KycStatus.APPROVED)).toThrow('KYC_ALREADY_APPROVED');
    expect(()=>assertKycSubmissionAllowed(KycStatus.NEEDS_CHANGES)).not.toThrow();
    expect(()=>assertKycSubmissionAllowed(KycStatus.PENDING)).not.toThrow();
  });
});

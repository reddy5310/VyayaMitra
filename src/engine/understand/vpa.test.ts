import { describe, expect, it } from 'vitest';
import { classifyVpa, nameFromHandle } from './vpa';

describe('classifyVpa', () => {
  const merchants: Array<[string, string]> = [
    ['paytmqr7x1a2b@ptys', 'Paytm'],
    ['paytm-24680@ptys', 'Paytm'],
    ['paytm.s2xyzab@pty', 'Paytm'],
    ['Q987654321@ybl', 'PhonePe'],
    ['BHARATPE.9A1B2C3D4E5F6789@fbpe', 'BharatPe'],
    ['gpay-98765432109@okbizaxis', 'Google Pay for Business'],
    ['bajajpay.1357924.abcd1234@indus', 'Bajaj Pay'],
    ['yespay.bizsbiz13579@yesbankltd', 'YesPay'],
  ];
  it.each(merchants)('%s is a merchant QR (%s)', (vpa, label) => {
    const v = classifyVpa(vpa);
    expect(v.cls).toBe('merchant');
    expect(v.source).toBe('qr');
    expect(v.label).toBe(label);
  });

  const other: Array<[string, string]> = [
    ['myntra2.payu@hd', 'gateway'],
    ['clinikally.cf@axis', 'gateway'],
    ['razorpay.store12@icici', 'gateway'],
    ['apollopharmacyoffline@axl', 'store'],
    ['sharmatraders@ybl', 'business'],
    ['kumarmedicals@okaxis', 'business'],
  ];
  it.each(other)('%s is a merchant (%s)', (vpa, source) => {
    const v = classifyVpa(vpa);
    expect(v.cls).toBe('merchant');
    expect(v.source).toBe(source);
  });

  const people = ['9849000001@ybl', '919849000001@paytm', 'meera.nair@oksbi', 'priya.menon@okaxis', 'rahulsen@okhdfcbank', 'k.suresh17-2@oksbi', 'qz71k8pw2@ybl', 'sunitaverma', 'rakeshvarmapd@ax'];
  it.each(people)('%s is a person', (vpa) => {
    expect(classifyVpa(vpa).cls).toBe('person');
  });

  it('flags phone-number handles', () => {
    expect(classifyVpa('9849000001@ybl').phone).toBe(true);
    expect(classifyVpa('meera.nair@oksbi').phone).toBe(false);
  });

  it('tolerates wrapped spaces and upper case', () => {
    expect(classifyVpa('BHARATPE.9A1B2C3D4E5F 6789@fbpe').cls).toBe('merchant');
  });
});

describe('nameFromHandle', () => {
  const table: Array<[string, string | undefined]> = [
    ['meera.nair@oksbi', 'Meera Nair'],
    ['k.suresh17-2@oksbi', 'K Suresh'],
    ['clinikally.cf@axis', 'Clinikally'],
    ['9849000001@ybl', undefined],
    ['q987654321@ybl', undefined],
  ];
  it.each(table)('%s → %s', (vpa, expected) => {
    expect(nameFromHandle(vpa)).toBe(expected);
  });
});

import { describe, expect, it } from 'vitest';
import { cleanMerchantText, repairBankName, repairFragments, titleCase } from './text';

describe('repairFragments', () => {
  const table: Array<[string, string]> = [
    ['Amazon I ndia', 'Amazon India'],
    ['ASTER PH ARMACY', 'ASTER PHARMACY'],
    ['RAMALAXM I NAGAR', 'RAMALAXMI NAGAR'],
    ['PRABHAVAT I NAGAR', 'PRABHAVATI NAGAR'],
    ['TIFFIN C', 'TIFFIN C'], // a FINAL letter is a cut-off word, never glued on
    ['P K BAKE RS', 'P K BAKERS'],
    ['Kalya ni Sweets', 'Kalyani Sweets'],
    ['V ishwa Narayan', 'Vishwa Narayan'],
    // real words and brands are never glued together
    ['SAI RAM STORES', 'SAI RAM STORES'],
    ['Apollo pharmacy', 'Apollo pharmacy'],
    ['KUMAR S', 'KUMAR S'],
    ['Bank interest', 'Bank interest'],
    ['A B C', 'A B C'],
  ];
  it.each(table)('%j → %j', (input, expected) => {
    expect(repairFragments(input)).toBe(expected);
  });
});

describe('cleanMerchantText', () => {
  const table: Array<[string, string]> = [
    ['UPI-412345678921-Amazon I ndia IN', 'Amazon India'],
    ['WWW EXCITEL COM', 'EXCITEL'],
    ['ACME FOODS PVT LTD', 'ACME FOODS'],
    ['Acme Foods Private Limited', 'Acme Foods'],
    ['ACME TECH LLP', 'ACME TECH'],
    ['MERCHANT -AXLe1b2c3d4e5f60718293a4b5c6db', 'MERCHANT'],
    ['SOME SHOP 9876543210', 'SOME SHOP'],
    ['  lots   of   space  ', 'lots of space'],
  ];
  it.each(table)('%j → %j', (input, expected) => {
    expect(cleanMerchantText(input)).toBe(expected);
  });
});

describe('titleCase', () => {
  const table: Array<[string, string]> = [
    ['RAMALAXMI NAGAR', 'Ramalaxmi Nagar'],
    ['sai ganesh mobiles', 'Sai Ganesh Mobiles'],
    ['KFC', 'KFC'],
    ['SRI VENKATESWARA HPC', 'Sri Venkateswara HPC'],
    ['H&M', 'H&M'],
  ];
  it.each(table)('%j → %j', (input, expected) => {
    expect(titleCase(input)).toBe(expected);
  });
});

describe('repairBankName', () => {
  const table: Array<[string, string | undefined]> = [
    ['State Bank Of I', 'State Bank of India'],
    ['HDF C BANKLTD', 'HDFC Bank'],
    ['ICICI Bank Limi', 'ICICI Bank'],
    ['Yes Bank Ltd', 'Yes Bank'],
    ['Bank of Baroda', 'Bank of Baroda'],
    ['AIRTEL PAYMENTS', 'Airtel Payments Bank'],
    ['xy', undefined],
  ];
  it.each(table)('%j → %j', (input, expected) => {
    expect(repairBankName(input)).toBe(expected);
  });
});

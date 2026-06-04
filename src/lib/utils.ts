/**
 * Utility function for Tailwind class merging
 */
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Currency formatter
 */
export const formatCurrency = (amount: any) => {
  const num = Number(amount);
  if (isNaN(num)) return '₦0.00';
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
  }).format(num);
};

/**
 * Truncate/sanitize SKU and Barcodes strictly to 6-digit alphanumeric
 */
export const cleanTo6Digits = (str: string | null | undefined): string => {
  if (!str) return '';
  const clean = String(str).replace(/[^a-zA-Z0-9]/g, '');
  if (clean.length > 6) {
    const digits = String(str).replace(/\D/g, '');
    if (digits.length >= 6) {
      return digits.slice(0, 6);
    }
    return clean.slice(0, 6);
  }
  return clean;
};

export const generate6DigitCode = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

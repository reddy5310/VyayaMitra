import { IncorrectPasswordError, PasswordRequiredError, ScannedPdfError, UnsupportedStatementError } from '@/parsing';

export interface ErrorView {
  title: string;
  body: string;
  hints: string[];
}

export function isScannedPdf(e: unknown): boolean {
  return e instanceof ScannedPdfError || codeOf(e) === 'scanned_pdf';
}
export function isUnsupported(e: unknown): boolean {
  return e instanceof UnsupportedStatementError || codeOf(e) === 'unsupported';
}

function codeOf(e: unknown): string | undefined {
  return typeof e === 'object' && e !== null && 'code' in e ? String((e as { code: unknown }).code) : undefined;
}

export function isPasswordRequired(e: unknown): boolean {
  return e instanceof PasswordRequiredError || codeOf(e) === 'password_required';
}
export function isIncorrectPassword(e: unknown): boolean {
  return e instanceof IncorrectPasswordError || codeOf(e) === 'incorrect_password';
}

/** Turns a parsing failure into a specific, actionable message. Nothing has been saved in any of these cases. */
export function describeImportError(e: unknown): ErrorView {
  if (isScannedPdf(e)) {
    return {
      title: 'This PDF is a scanned image',
      body: 'There is no text in it to read directly.',
      hints: [
        'Read it with on-device OCR, or download the e-statement PDF from your net banking or bank app instead.',
        'CSV and Excel exports also work.',
      ],
    };
  }
  if (isUnsupported(e)) {
    const hints = e instanceof UnsupportedStatementError ? e.hints : [];
    return {
      title: 'We could not read this statement',
      body: e instanceof Error && e.message ? e.message : 'The layout was not recognised.',
      hints: hints.length ? hints : ['Check the supported formats below, and use the PDF or CSV downloaded from your bank.'],
    };
  }
  return {
    title: 'Something went wrong while reading this file',
    body: `${e instanceof Error && e.message ? e.message : 'Unknown error.'} Nothing was saved.`,
    hints: ['Try the file again, or download a fresh copy from your bank.'],
  };
}

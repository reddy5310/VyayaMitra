/** The PDF is encrypted and no password was supplied. */
export class PasswordRequiredError extends Error {
  readonly code = 'password_required';
  constructor() {
    super('This statement is password-protected. Enter its password to open it on this device.');
    this.name = 'PasswordRequiredError';
  }
}

/** A password was supplied but it does not open the PDF. */
export class IncorrectPasswordError extends Error {
  readonly code = 'incorrect_password';
  constructor() {
    super('That password did not open the statement. Banks often use a combination such as name + date of birth.');
    this.name = 'IncorrectPasswordError';
  }
}

/** The PDF has no extractable text layer (scanned image). */
export class ScannedPdfError extends Error {
  readonly code = 'scanned_pdf';
  constructor() {
    super('This PDF is a scanned image with no text. Download the e-statement PDF from your net banking instead.');
    this.name = 'ScannedPdfError';
  }
}

/** No parser recognised the file, or the recognised parser found zero transactions. */
export class UnsupportedStatementError extends Error {
  readonly code = 'unsupported';
  constructor(
    message: string,
    readonly hints: string[] = [],
  ) {
    super(message);
    this.name = 'UnsupportedStatementError';
  }
}

export type StatementError =
  | PasswordRequiredError
  | IncorrectPasswordError
  | ScannedPdfError
  | UnsupportedStatementError;

export function isStatementError(e: unknown): e is StatementError {
  return (
    e instanceof PasswordRequiredError ||
    e instanceof IncorrectPasswordError ||
    e instanceof ScannedPdfError ||
    e instanceof UnsupportedStatementError
  );
}

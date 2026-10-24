import type { AccountType, Institution, ParsedStatement } from '@/domain/types';
import type { LayoutDoc } from '../pdf/types';

export interface Detection {
  /** 0..1 */
  confidence: number;
  reasons: string[];
}

export interface ParserInfo {
  id: string;
  version: number;
  label: string;
  institution: Institution;
  accountType: AccountType | 'any';
  fileTypes: ('pdf' | 'csv')[];
  notes?: string;
}

export interface ParseContext {
  fileName: string;
}

export interface PdfParser extends ParserInfo {
  kind: 'pdf';
  detect(doc: LayoutDoc): Detection;
  parse(doc: LayoutDoc, ctx: ParseContext): ParsedStatement;
}

/** A CSV file read into records (RFC 4180). */
export interface CsvTable {
  /** Every record, including preamble and header rows. */
  records: string[][];
}

export interface CsvParser extends ParserInfo {
  kind: 'csv';
  detect(table: CsvTable): Detection;
  parse(table: CsvTable, ctx: ParseContext): ParsedStatement;
}

export type AnyParser = PdfParser | CsvParser;

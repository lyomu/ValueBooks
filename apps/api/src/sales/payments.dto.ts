import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
  Matches,
  ValidateNested,
} from 'class-validator';

export const PAYMENT_MODES = [
  'CASH',
  'BANK_TRANSFER',
  'CHEQUE',
  'MOBILE_MONEY',
  'CARD',
  'OTHER',
] as const;

const trimOrUndefined = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
};

const trimUpper = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

const moneyString = ({ value }: { value: unknown }): unknown => {
  if (typeof value === 'number' && Number.isInteger(value)) return String(value);
  return typeof value === 'string' ? value.trim() : value;
};

export class PaymentAllocationLineDto {
  @IsString()
  @Length(36, 36)
  invoiceId!: string;

  @IsString()
  @Matches(/^\d+$/, { message: 'amountMinor must be a non-negative integer string' })
  @Transform(moneyString)
  amountMinor!: string;
}

export class CreatePaymentDto {
  @IsString()
  @Length(36, 36)
  contactId!: string;

  @IsString()
  @IsISO8601({ strict: true })
  @Transform(trimOrUndefined)
  receivedDate!: string;

  @IsOptional()
  @IsString()
  @Length(3, 3)
  @Transform(trimUpper)
  currency?: string;

  @IsString()
  @Matches(/^\d+$/, { message: 'amountMinor must be a non-negative integer string' })
  @Transform(moneyString)
  amountMinor!: string;

  /** Bank fee deducted from the receipt. Reduces the deposit, never the amount owed. */
  @IsOptional()
  @IsString()
  @Matches(/^\d+$/, { message: 'bankChargesMinor must be a non-negative integer string' })
  @Transform(moneyString)
  bankChargesMinor?: string;

  /** Tax the customer withheld at source. Settles the invoice but never reaches our bank. */
  @IsOptional()
  @IsString()
  @Matches(/^\d+$/, { message: 'withholdingTaxMinor must be a non-negative integer string' })
  @Transform(moneyString)
  withholdingTaxMinor?: string;

  @IsOptional()
  @IsIn(PAYMENT_MODES)
  @Transform(trimUpper)
  paymentMode?: (typeof PAYMENT_MODES)[number];

  /** Bank account the money landed in. Defaults to the organization's `bank_default` account. */
  @IsOptional()
  @IsUUID()
  depositAccountId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(140)
  @Transform(trimOrUndefined)
  reference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  @Transform(trimOrUndefined)
  notes?: string;

  /**
   * Invoices to apply this payment to in the same request. Recording and allocating in one step is
   * what the record-payment dialog submits; the allocation runs under the same idempotency key, so
   * a retried submit cannot double-apply.
   */
  @IsOptional()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => PaymentAllocationLineDto)
  allocations?: PaymentAllocationLineDto[];
}

export class AllocatePaymentDto {
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => PaymentAllocationLineDto)
  allocations!: PaymentAllocationLineDto[];
}

export class ListPaymentsQueryDto {
  @IsOptional()
  @IsIn(['UNAPPLIED', 'PARTIALLY_ALLOCATED', 'FULLY_ALLOCATED'])
  status?: string;
}

export class OpenInvoicesQueryDto {
  @IsString()
  @IsUUID()
  contactId!: string;
}

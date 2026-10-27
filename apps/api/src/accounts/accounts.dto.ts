import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class BankAccountDto {
  @IsString() @IsNotEmpty() @MaxLength(80) bankName: string;
  @IsString() @IsNotEmpty() @MaxLength(80) name: string;
  @IsOptional() @IsString() @MaxLength(34) iban?: string;
  @IsOptional() @IsString() @Length(3, 3) currency?: string;
  @IsOptional() @IsString() branchId?: string;
}

export class UpdateBankAccountDto {
  @IsOptional() @IsString() @MaxLength(80) name?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsString() branchId?: string | null;
}

export class ManualBalanceDto {
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) balance: number;
  @IsDateString() asOf: string;
}

export class CardAccountDto {
  @IsString() @IsNotEmpty() @MaxLength(80) name: string;
  @IsString() @IsNotEmpty() @MaxLength(80) bankName: string;
  @Matches(/^\d{4}$/, { message: 'Yalnızca kartın son 4 hanesi girilmeli' }) last4: string;
  @IsString() @IsNotEmpty() @MaxLength(120) holderName: string;
  @IsOptional() @IsString() holderUserId?: string;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) creditLimit?: number;
  @IsOptional() @IsString() @Length(3, 3) currency?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(31) statementDay?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(31) dueDay?: number;
  @IsOptional() @IsString() branchId?: string;
}

export class UpdateCardAccountDto {
  @IsOptional() @IsString() @MaxLength(80) name?: string;
  @IsOptional() @IsString() holderUserId?: string | null;
  @IsOptional() @IsString() @MaxLength(120) holderName?: string;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) creditLimit?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsString() branchId?: string | null;
}

export class StatementDto {
  @IsDateString() periodStart: string;
  @IsDateString() periodEnd: string;
  @IsDateString() dueDate: string;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) totalAmount: number;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) minimumPayment?: number;
}

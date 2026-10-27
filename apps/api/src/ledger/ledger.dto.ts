import { CounterpartyType, InvoiceType, Recurrence } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsDateString, IsEmail, IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, Length, MaxLength, Min } from 'class-validator';

export class CounterpartyDto {
  @IsEnum(CounterpartyType) type: CounterpartyType;
  @IsString() @IsNotEmpty() @MaxLength(40) code: string;
  @IsString() @IsNotEmpty() @MaxLength(200) name: string;
  @IsOptional() @IsString() @MaxLength(20) taxNumber?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() @MaxLength(30) phone?: string;
}

export class UpdateCounterpartyDto {
  @IsOptional() @IsEnum(CounterpartyType) type?: CounterpartyType;
  @IsOptional() @IsString() @MaxLength(200) name?: string;
  @IsOptional() @IsString() @MaxLength(20) taxNumber?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() @MaxLength(30) phone?: string;
}

export class InvoiceDto {
  @IsEnum(InvoiceType) type: InvoiceType;
  @IsString() @IsNotEmpty() @MaxLength(40) number: string;
  @IsString() @IsNotEmpty() counterpartyId: string;
  @IsDateString() issueDate: string;
  @IsDateString() dueDate: string;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) total: number;
  @IsOptional() @IsString() @Length(3, 3) currency?: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsOptional() @IsString() branchId?: string;
}

export class UpdateInvoiceDto {
  @IsOptional() @IsDateString() dueDate?: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
}

export class InvoicePaymentDto {
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) amount: number;
  @IsOptional() @IsString() transactionId?: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class PlannedPaymentDto {
  @IsString() @IsNotEmpty() @MaxLength(200) title: string;
  @IsString() @IsNotEmpty() @MaxLength(60) category: string;
  @IsOptional() @IsString() counterpartyId?: string;
  @IsOptional() @IsString() invoiceId?: string;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) amount: number;
  @IsOptional() @IsString() @Length(3, 3) currency?: string;
  @IsDateString() dueDate: string;
  @IsOptional() @IsEnum(Recurrence) recurrence?: Recurrence;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class UpdatePlannedPaymentDto {
  @IsOptional() @IsString() @MaxLength(200) title?: string;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) amount?: number;
  @IsOptional() @IsDateString() dueDate?: string;
  @IsOptional() @IsEnum(Recurrence) recurrence?: Recurrence;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class MarkPaidDto {
  @IsOptional() @IsString() transactionId?: string;
}

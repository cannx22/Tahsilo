import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsDateString, IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, Length, MaxLength, Min } from 'class-validator';

export class UpdateTransactionDto {
  @IsOptional() @IsString() categoryId?: string | null;
  @IsOptional() @IsString() @MaxLength(1000) note?: string | null;
  @IsOptional() @IsString() @MaxLength(200) counterpartyName?: string | null;
}

export class BulkCategorizeDto {
  @IsArray() @ArrayMaxSize(500) @IsString({ each: true }) ids: string[];
  @IsString() @IsNotEmpty() categoryId: string;
}

export class ManualTransactionDto {
  @IsDateString() date: string;
  @IsString() @IsNotEmpty() @MaxLength(500) description: string;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) amount: number;
  @IsEnum(['IN', 'OUT']) direction: 'IN' | 'OUT';
  @IsOptional() @IsString() @Length(3, 3) currency?: string;
  @IsOptional() @IsString() bankAccountId?: string;
  @IsOptional() @IsString() cardAccountId?: string;
  @IsOptional() @IsString() categoryId?: string;
  @IsOptional() @IsString() @MaxLength(200) counterpartyName?: string;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

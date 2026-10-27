import { Type } from 'class-transformer';
import { IsDateString, IsNotEmpty, IsNumber, IsOptional, IsString, Length, MaxLength, Min } from 'class-validator';

export class CreateExpenseDto {
  /** Kart/banka hareketinden gider oluşturulurken tutar ve tarih hareketten alınır. */
  @IsOptional() @IsString() transactionId?: string;
  @IsString() @IsNotEmpty() categoryId: string;
  @IsOptional() @IsString() departmentId?: string;
  @IsOptional() @IsString() costCenterId?: string;
  @IsOptional() @IsString() @MaxLength(120) project?: string;
  @IsOptional() @IsString() @MaxLength(200) merchant?: string;
  @IsString() @IsNotEmpty() @MaxLength(1000) description: string;
  // Yalnızca hareketsiz (ör. nakit) giderlerde
  @IsOptional() @IsDateString() date?: string;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) amount?: number;
  @IsOptional() @IsString() @Length(3, 3) currency?: string;
}

export class UpdateExpenseDto {
  @IsOptional() @IsString() categoryId?: string;
  @IsOptional() @IsString() departmentId?: string | null;
  @IsOptional() @IsString() costCenterId?: string | null;
  @IsOptional() @IsString() @MaxLength(120) project?: string | null;
  @IsOptional() @IsString() @MaxLength(200) merchant?: string | null;
  @IsOptional() @IsString() @MaxLength(1000) description?: string;
}

export class DecisionDto {
  @IsOptional() @IsString() @MaxLength(1000) comment?: string;
}

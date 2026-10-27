import { Role } from '@prisma/client';
import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateUserDto {
  @IsString() @IsNotEmpty() @MaxLength(120) name: string;
  @IsEmail() email: string;
  @IsEnum(Role) role: Role;
  @IsOptional() @IsString() departmentId?: string;
  @IsOptional() @IsString() branchId?: string;
  @IsString() @MinLength(10, { message: 'Parola en az 10 karakter olmalı' }) password: string;
}

export class UpdateUserDto {
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsOptional() @IsEnum(Role) role?: Role;
  @IsOptional() @IsString() departmentId?: string | null;
  @IsOptional() @IsString() branchId?: string | null;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class NameDto {
  @IsString() @IsNotEmpty() @MaxLength(120) name: string;
}

export class CostCenterDto {
  @IsString() @IsNotEmpty() @MaxLength(30) code: string;
  @IsString() @IsNotEmpty() @MaxLength(120) name: string;
}

export class CategoryDto {
  @IsString() @IsNotEmpty() @MaxLength(120) name: string;
  @IsOptional() @IsString() @MaxLength(30) code?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) keywords?: string[];
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateCategoryDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(30) code?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) keywords?: string[];
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class TenantDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(20) taxNumber?: string;
}

export class BranchDto {
  @IsString() @IsNotEmpty() @MaxLength(20) code: string;
  @IsString() @IsNotEmpty() @MaxLength(120) name: string;
}

export class UpdateBranchDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(120) name?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

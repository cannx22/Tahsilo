import { IsBoolean, IsEmail, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class RegisterDto {
  @IsString() @IsNotEmpty() @MaxLength(120) companyName: string;
  @IsOptional() @IsString() @MaxLength(20) taxNumber?: string;
  @IsString() @IsNotEmpty() @MaxLength(120) name: string;
  @IsEmail() email: string;
  @IsString() @MinLength(10, { message: 'Parola en az 10 karakter olmalı' }) password: string;
}

export class LoginDto {
  @IsEmail() email: string;
  @IsString() @IsNotEmpty() password: string;
}

export class MfaCodeDto {
  @Matches(/^\d{6}$/, { message: 'Doğrulama kodu 6 haneli olmalı' }) code: string;
}

export class MfaVerifyDto extends MfaCodeDto {
  @IsString() @IsNotEmpty() ticket: string;
}

export class MfaDisableDto extends MfaCodeDto {
  @IsString() @IsNotEmpty() password: string;
}

export class ChangePasswordDto {
  @IsString() @IsNotEmpty() currentPassword: string;
  @IsString() @MinLength(10, { message: 'Parola en az 10 karakter olmalı' }) newPassword: string;
}

export class PreferencesDto {
  @IsOptional() @IsBoolean() emailNotifications?: boolean;
}

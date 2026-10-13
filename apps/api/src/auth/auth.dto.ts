import { Transform } from 'class-transformer';
import { IsEmail, IsOptional, IsString, IsUUID, Length, Matches, MaxLength } from 'class-validator';

const normalizeEmail = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export class SignupDto {
  @IsEmail()
  @MaxLength(254)
  @Transform(normalizeEmail)
  email!: string;

  @IsString()
  @Length(12, 128)
  @Matches(/[a-z]/, { message: 'password must include a lowercase letter' })
  @Matches(/[A-Z]/, { message: 'password must include an uppercase letter' })
  @Matches(/[0-9]/, { message: 'password must include a number' })
  password!: string;

  @IsOptional()
  @IsUUID()
  registrationIntentId?: string;
}

export class UpdateProfileDto {
  @IsString()
  @Length(2, 120)
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  displayName!: string;
}

export class LoginDto {
  @IsEmail()
  @MaxLength(254)
  @Transform(normalizeEmail)
  email!: string;

  @IsString()
  @Length(1, 128)
  password!: string;
}

export class MfaCodeDto {
  @IsString()
  @Matches(/^\d{6,8}$/, { message: 'code must be a 6 to 8 digit number' })
  code!: string;
}

export class EmailDto {
  @IsEmail()
  @MaxLength(254)
  @Transform(normalizeEmail)
  email!: string;
}

export class TokenDto {
  @IsString()
  @Length(20, 256)
  token!: string;
}

export class ResetPasswordDto extends TokenDto {
  @IsString()
  @Length(12, 128)
  @Matches(/[a-z]/, { message: 'password must include a lowercase letter' })
  @Matches(/[A-Z]/, { message: 'password must include an uppercase letter' })
  @Matches(/[0-9]/, { message: 'password must include a number' })
  password!: string;
}

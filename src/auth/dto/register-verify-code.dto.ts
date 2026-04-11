import { IsEmail, IsString, Matches } from 'class-validator';

export class RegisterVerifyCodeDto {
  @IsEmail()
  email: string;

  @IsString()
  @Matches(/^\d{6}$/, { message: '인증번호는 숫자 6자리여야 합니다.' })
  code: string;
}

import { IsEmail, IsString, Length, Matches } from 'class-validator';

export class UpdateMeEmailVerifyDto {
  @IsEmail({}, { message: '올바른 이메일 형식을 입력해 주세요.' })
  email: string;

  @IsString()
  @Length(6, 6, { message: '인증번호 6자리를 입력해 주세요.' })
  @Matches(/^\d{6}$/, { message: '인증번호는 숫자 6자리입니다.' })
  code: string;
}

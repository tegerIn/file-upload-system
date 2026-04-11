import { IsEmail, IsOptional, IsString, Matches, MinLength } from 'class-validator';
import {
  PASSWORD_POLICY_MESSAGE,
  PASSWORD_POLICY_REGEX,
} from '../password-policy';

export class UpdateMeDto {
  @IsOptional()
  @IsString()
  @MinLength(1, { message: '이름을 입력해 주세요.' })
  name?: string;

  @IsOptional()
  @IsEmail({}, { message: '올바른 이메일 형식을 입력해 주세요.' })
  email?: string;

  /** 이메일 변경 시 인증 완료 후 발급된 토큰(64자리 16진수) */
  @IsOptional()
  @IsString()
  emailVerifyToken?: string;

  @IsOptional()
  @IsString()
  @Matches(PASSWORD_POLICY_REGEX, {
    message: PASSWORD_POLICY_MESSAGE,
  })
  newPassword?: string;

  @IsOptional()
  @IsString()
  confirmNewPassword?: string;
}

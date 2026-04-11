import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @IsString()
  @MinLength(4, { message: '아이디를 입력해 주세요.' })
  @MaxLength(20)
  @Matches(/^[a-zA-Z0-9_]+$/, {
    message: '아이디 형식이 올바르지 않습니다.',
  })
  loginId: string;

  @IsString()
  @MinLength(1)
  password: string;
}

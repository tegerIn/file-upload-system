import { IsEmail, IsString, MinLength } from 'class-validator';

export class FindIdSendDto {
  @IsString()
  @MinLength(1, { message: '이름을 입력해 주세요.' })
  name: string;

  @IsEmail()
  email: string;
}

import { IsEmail } from 'class-validator';

export class UpdateMeEmailSendDto {
  @IsEmail({}, { message: '올바른 이메일 형식을 입력해 주세요.' })
  email: string;
}

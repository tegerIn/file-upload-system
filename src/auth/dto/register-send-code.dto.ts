import { IsEmail } from 'class-validator';

export class RegisterSendCodeDto {
  @IsEmail()
  email: string;
}

import { IsString, MinLength } from 'class-validator';

export class RefreshSessionDto {
  @IsString()
  @MinLength(32, { message: '리프레시 토큰이 올바르지 않습니다.' })
  refreshToken!: string;
}

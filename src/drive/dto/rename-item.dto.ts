import { IsString, MaxLength, MinLength } from 'class-validator';

export class RenameItemDto {
  @IsString()
  @MinLength(1, { message: '이름을 입력해 주세요.' })
  @MaxLength(100, { message: '이름은 100자 이하여야 합니다.' })
  name: string;
}

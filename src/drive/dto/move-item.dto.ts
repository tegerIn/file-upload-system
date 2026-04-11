import { IsOptional, IsUUID } from 'class-validator';

export class MoveItemDto {
  /** 루트로 이동할 때는 생략하거나 null */
  @IsOptional()
  @IsUUID()
  parentId?: string | null;
}

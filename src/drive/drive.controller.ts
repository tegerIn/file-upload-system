import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateFolderDto } from './dto/create-folder.dto';
import { MoveItemDto } from './dto/move-item.dto';
import { RenameItemDto } from './dto/rename-item.dto';
import { DriveService, isImageMime } from './drive.service';

type AuthedRequest = {
  user: { id: string; email: string; name: string | null };
};

@Controller('api/drive')
@UseGuards(JwtAuthGuard)
export class DriveController {
  constructor(private readonly drive: DriveService) {}

  @Get('items')
  async list(@Req() req: AuthedRequest, @Query('parentId') parentId?: string) {
    const pid = parentId === undefined || parentId === '' ? null : parentId;
    if (pid && !this.isUuid(pid)) {
      throw new BadRequestException('parentId가 올바르지 않습니다.');
    }
    return this.drive.list(req.user.id, pid);
  }

  @Get('trash')
  listTrash(@Req() req: AuthedRequest) {
    return this.drive.listTrash(req.user.id);
  }

  @Delete('trash')
  purgeAllTrash(@Req() req: AuthedRequest) {
    return this.drive.purgeAllTrash(req.user.id);
  }

  @Post('folders')
  createFolder(@Req() req: AuthedRequest, @Body() dto: CreateFolderDto) {
    return this.drive.createFolder(req.user.id, dto);
  }

  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 100 * 1024 * 1024 },
    }),
  )
  async upload(
    @Req() req: AuthedRequest,
    @UploadedFile() file: Express.Multer.File,
    @Body('parentId') parentId?: string,
    @Body('section') section?: string,
  ) {
    if (!file) {
      throw new BadRequestException('파일이 필요합니다.');
    }
    const pid = parentId === undefined || parentId === '' ? null : parentId;
    if (pid && !this.isUuid(pid)) {
      throw new BadRequestException('parentId가 올바르지 않습니다.');
    }
    const uploadSection: 'docs' | 'images' = section === 'images' ? 'images' : 'docs';
    const created = await this.drive.uploadFile(req.user.id, file, pid, uploadSection);
    return {
      ...created,
      isImage: isImageMime(created.mimeType),
    };
  }

  @Delete('items/:id/permanent')
  purgeTrashItem(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.drive.purgeTrashItem(req.user.id, id);
  }

  @Delete('items/:id')
  deleteItem(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.drive.deleteItem(req.user.id, id);
  }

  @Patch('items/:id/move')
  moveItem(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MoveItemDto,
  ) {
    const nextParent =
      dto.parentId === undefined || dto.parentId === '' ? null : dto.parentId;
    if (nextParent && !this.isUuid(nextParent)) {
      throw new BadRequestException('parentId가 올바르지 않습니다.');
    }
    return this.drive.moveItem(req.user.id, id, nextParent);
  }

  @Patch('items/:id/rename')
  renameItem(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RenameItemDto,
  ) {
    return this.drive.renameItem(req.user.id, id, dto.name);
  }

  @Get('files/:id/raw')
  async rawFile(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ) {
    const item = await this.drive.getFileForUser(req.user.id, id, true);
    const buf = await this.drive.readFileBuffer(req.user.id, id, true);
    res.setHeader('Content-Type', item.mimeType || 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `inline; filename*=UTF-8''${encodeURIComponent(item.name)}`,
    );
    res.send(buf);
  }

  private isUuid(v: string) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      v,
    );
  }
}

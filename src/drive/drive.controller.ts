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
import type { AuthedRequest } from '../auth/types/authed-request.type';
import { DriveService, isImageMime } from './drive.service';
import { CreateFolderDto } from './dto/create-folder.dto';
import { MoveItemDto } from './dto/move-item.dto';
import { RenameItemDto } from './dto/rename-item.dto';

const MAX_FILE_SIZE = 100 * 1024 * 1024;

@Controller('api/drive')
@UseGuards(JwtAuthGuard)
export class DriveController {
  constructor(private readonly drive: DriveService) {}

  @Get('items')
  list(
    @Req() req: AuthedRequest,
    @Query('parentId', new ParseUUIDPipe({ optional: true })) parentId?: string,
  ) {
    return this.drive.list(req.user.id, parentId ?? null);
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
      limits: { fileSize: MAX_FILE_SIZE },
    }),
  )
  async upload(
    @Req() req: AuthedRequest,
    @UploadedFile() file: Express.Multer.File,
    @Body('parentId', new ParseUUIDPipe({ optional: true })) parentId?: string,
    @Body('section') section?: string,
  ) {
    if (!file) {
      throw new BadRequestException('파일이 필요합니다.');
    }
    const uploadSection: 'docs' | 'images' =
      section === 'images' ? 'images' : 'docs';
    const created = await this.drive.uploadFile(
      req.user.id,
      file,
      parentId ?? null,
      uploadSection,
    );
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
    return this.drive.moveItem(req.user.id, id, dto.parentId ?? null);
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

}

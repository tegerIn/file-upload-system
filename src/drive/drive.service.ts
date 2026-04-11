import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DriveItem, DriveItemType } from '@prisma/client';
import { randomUUID } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { CreateFolderDto } from './dto/create-folder.dto';

export function isImageMime(mime: string | null | undefined): boolean {
  if (!mime) return false;
  return mime.startsWith('image/');
}

/**
 * multipart 업로드 시 한글 파일명이 latin1로 깨져 들어오는 경우를 UTF-8로 복원한다.
 */
function decodeUploadedFilename(raw: string): string {
  if (!raw) return 'unnamed';
  const latin1Decoded = Buffer.from(raw, 'latin1').toString('utf8').normalize('NFC');
  const hasReplacement = latin1Decoded.includes('\uFFFD');
  if (hasReplacement) return raw;
  const sourceLooksMojibake = /[ÃÐÁ¢À-ÿ]/.test(raw);
  const decodedHasHangul = /[가-힣]/.test(latin1Decoded);
  if (sourceLooksMojibake || decodedHasHangul) return latin1Decoded;
  return raw;
}

const TRASH_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/** 클라이언트와 동일한 문서/이미지 섹션 루트 폴더 이름 */
const SECTION_DOCS_ROOT_NAME = '__MYDRIVE_DOCS_ROOT__';
const SECTION_IMAGES_ROOT_NAME = '__MYDRIVE_IMAGES_ROOT__';

function isSystemSectionRootFolder(row: {
  type: DriveItemType;
  name: string;
  parentId: string | null;
  sectionKey: string | null;
}): boolean {
  if (row.type !== DriveItemType.FOLDER || row.parentId !== null) return false;
  if (row.sectionKey === 'DOCS_ROOT' || row.sectionKey === 'IMAGES_ROOT') {
    return true;
  }
  return (
    row.name === SECTION_DOCS_ROOT_NAME || row.name === SECTION_IMAGES_ROOT_NAME
  );
}

@Injectable()
export class DriveService {
  private readonly uploadRoot: string;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.uploadRoot = path.resolve(
      process.cwd(),
      config.get<string>('UPLOAD_DIR') ?? './uploads',
    );
  }

  private userDir(userId: string) {
    return path.join(this.uploadRoot, userId);
  }

  private filePath(userId: string, storageKey: string) {
    return path.join(this.userDir(userId), storageKey);
  }

  async ensureUploadDir(userId: string) {
    await fs.mkdir(this.userDir(userId), { recursive: true });
  }

  async list(userId: string, parentId: string | null) {
    await this.purgeExpiredTrash(userId);
    const items = await this.prisma.driveItem.findMany({
      where: { userId, parentId, deletedAt: null },
      orderBy: [{ type: 'desc' }, { name: 'asc' }],
    });
    return items.map((item) => ({
      id: item.id,
      name: item.name,
      type: item.type,
      parentId: item.parentId,
      sectionKey: item.sectionKey,
      mimeType: item.mimeType,
      size: item.size,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      isImage: item.type === DriveItemType.FILE && isImageMime(item.mimeType),
    }));
  }

  async createFolder(userId: string, dto: CreateFolderDto) {
    await this.purgeExpiredTrash(userId);
    const parentId = dto.parentId ?? null;
    if (parentId) {
      await this.assertFolderOwned(userId, parentId);
    }
    await this.assertUniqueName(userId, parentId, dto.name);
    const sectionKey =
      parentId === null && dto.name === SECTION_DOCS_ROOT_NAME
        ? 'DOCS_ROOT'
        : parentId === null && dto.name === SECTION_IMAGES_ROOT_NAME
          ? 'IMAGES_ROOT'
          : null;
    return this.prisma.driveItem.create({
      data: {
        name: dto.name,
        type: DriveItemType.FOLDER,
        userId,
        parentId,
        sectionKey,
      },
    });
  }

  async uploadFile(
    userId: string,
    file: Express.Multer.File,
    parentId: string | null,
    section: 'docs' | 'images',
  ) {
    await this.purgeExpiredTrash(userId);
    const resolvedParentId = parentId;
    if (resolvedParentId) {
      await this.assertFolderOwned(userId, resolvedParentId);
    }
    const isImage = isImageMime(file.mimetype);
    if (section === 'images' && !isImage) {
      throw new BadRequestException('이미지 페이지에서는 이미지 파일만 업로드할 수 있습니다.');
    }
    const name = decodeUploadedFilename(file.originalname || 'unnamed');
    await this.assertUniqueName(userId, resolvedParentId, name);
    const storageKey = randomUUID();
    await this.ensureUploadDir(userId);
    const dest = this.filePath(userId, storageKey);
    await fs.writeFile(dest, file.buffer);

    return this.prisma.driveItem.create({
      data: {
        name,
        type: DriveItemType.FILE,
        userId,
        parentId: resolvedParentId,
        storageKey,
        mimeType: file.mimetype || 'application/octet-stream',
        size: file.size,
      },
    });
  }

  async deleteItem(userId: string, id: string) {
    await this.purgeExpiredTrash(userId);
    const item = await this.prisma.driveItem.findFirst({
      where: { id, userId, deletedAt: null },
    });
    if (!item) {
      throw new NotFoundException('항목을 찾을 수 없습니다.');
    }
    if (isSystemSectionRootFolder(item)) {
      throw new BadRequestException('문서·이미지 루트 폴더는 삭제할 수 없습니다.');
    }

    if (item.type === DriveItemType.FILE) {
      const deletedAt = new Date();
      const purgeAt = new Date(deletedAt.getTime() + TRASH_RETENTION_MS);
      await this.prisma.driveItem.update({
        where: { id },
        data: { deletedAt, purgeAt },
      });
      return { ok: true };
    }

    const subtreeIds = await this.collectSubtreeIds(userId, id);
    const rows = await this.prisma.driveItem.findMany({
      where: { userId, id: { in: subtreeIds } },
      select: { id: true, type: true },
    });
    const fileIds = rows.filter((r) => r.type === DriveItemType.FILE).map((r) => r.id);
    const deletedAt = new Date();
    const purgeAt = new Date(deletedAt.getTime() + TRASH_RETENTION_MS);

    if (fileIds.length > 0) {
      await this.prisma.driveItem.updateMany({
        where: { userId, id: { in: fileIds } },
        data: { deletedAt, purgeAt, parentId: null },
      });
    }

    await this.prisma.driveItem.delete({ where: { id } });
    return { ok: true };
  }

  /** 휴지통 항목을 즉시 영구 삭제한다(하위 포함). */
  async purgeTrashItem(userId: string, id: string) {
    await this.purgeExpiredTrash(userId);
    const item = await this.prisma.driveItem.findFirst({
      where: { id, userId, deletedAt: { not: null } },
    });
    if (!item) {
      throw new NotFoundException('항목을 찾을 수 없습니다.');
    }
    const ids = await this.collectTrashSubtreeIds(userId, id);
    const rows = await this.prisma.driveItem.findMany({
      where: { userId, id: { in: ids } },
      select: { storageKey: true },
    });
    const keys = rows.map((r) => r.storageKey).filter((k): k is string => !!k);
    await this.prisma.driveItem.deleteMany({ where: { userId, id: { in: ids } } });
    for (const key of keys) {
      try {
        await fs.unlink(this.filePath(userId, key));
      } catch {
        /* ignore missing file */
      }
    }
    return { ok: true };
  }

  /** 휴지통의 모든 파일을 영구 삭제한다. */
  async purgeAllTrash(userId: string): Promise<{ count: number }> {
    await this.purgeExpiredTrash(userId);
    const items = await this.prisma.driveItem.findMany({
      where: {
        userId,
        deletedAt: { not: null },
        type: DriveItemType.FILE,
      },
      select: { id: true, storageKey: true },
    });
    if (!items.length) {
      return { count: 0 };
    }
    const ids = items.map((x) => x.id);
    const keys = items.map((x) => x.storageKey).filter((k): k is string => !!k);
    await this.prisma.driveItem.deleteMany({ where: { userId, id: { in: ids } } });
    for (const key of keys) {
      try {
        await fs.unlink(this.filePath(userId, key));
      } catch {
        /* ignore missing file */
      }
    }
    return { count: items.length };
  }

  async listTrash(userId: string) {
    await this.purgeExpiredTrash(userId);
    const items = await this.prisma.driveItem.findMany({
      where: {
        userId,
        deletedAt: { not: null },
        type: DriveItemType.FILE,
      },
      orderBy: [{ deletedAt: 'desc' }, { name: 'asc' }],
    });
    return items.map((item) => ({
      id: item.id,
      name: item.name,
      type: item.type,
      parentId: item.parentId,
      sectionKey: item.sectionKey,
      mimeType: item.mimeType,
      size: item.size,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      deletedAt: item.deletedAt,
      purgeAt: item.purgeAt,
      isImage: item.type === DriveItemType.FILE && isImageMime(item.mimeType),
    }));
  }

  async hardDeleteAllByUser(userId: string): Promise<void> {
    const files = await this.prisma.driveItem.findMany({
      where: { userId, type: DriveItemType.FILE, storageKey: { not: null } },
      select: { storageKey: true },
    });
    await this.prisma.driveItem.deleteMany({ where: { userId } });
    for (const row of files) {
      if (!row.storageKey) continue;
      try {
        await fs.unlink(this.filePath(userId, row.storageKey));
      } catch {
        /* ignore missing file */
      }
    }
    try {
      await fs.rm(this.userDir(userId), { recursive: true, force: true });
    } catch {
      /* ignore missing dir */
    }
  }

  private async purgeExpiredTrash(userId: string): Promise<void> {
    const expired = await this.prisma.driveItem.findMany({
      where: {
        userId,
        deletedAt: { not: null },
        purgeAt: { lte: new Date() },
      },
      select: { id: true, storageKey: true },
    });
    if (!expired.length) return;
    const ids = expired.map((x) => x.id);
    const keys = expired.map((x) => x.storageKey).filter((x): x is string => !!x);
    await this.prisma.driveItem.deleteMany({ where: { userId, id: { in: ids } } });
    for (const key of keys) {
      try {
        await fs.unlink(this.filePath(userId, key));
      } catch {
        /* ignore missing file */
      }
    }
  }

  private async collectSubtreeIds(userId: string, rootId: string): Promise<string[]> {
    const root = await this.prisma.driveItem.findFirst({
      where: { id: rootId, userId, deletedAt: null },
      select: { id: true },
    });
    if (!root) return [];
    const ids: string[] = [root.id];
    const stack: string[] = [root.id];
    while (stack.length) {
      const current = stack.pop()!;
      const children = await this.prisma.driveItem.findMany({
        where: { userId, parentId: current, deletedAt: null },
        select: { id: true },
      });
      for (const child of children) {
        ids.push(child.id);
        stack.push(child.id);
      }
    }
    return ids;
  }

  async moveItem(userId: string, id: string, newParentId: string | null) {
    await this.purgeExpiredTrash(userId);
    const item = await this.prisma.driveItem.findFirst({
      where: { id, userId },
    });
    if (!item) {
      throw new NotFoundException('항목을 찾을 수 없습니다.');
    }
    if (item.deletedAt !== null) {
      return this.moveTrashedItem(userId, item, newParentId);
    }
    if (isSystemSectionRootFolder(item)) {
      throw new BadRequestException('문서·이미지 루트 폴더는 이동할 수 없습니다.');
    }
    if (newParentId) {
      const parent = await this.assertFolderOwned(userId, newParentId);
      if (parent.id === item.id) {
        throw new BadRequestException('자기 자신으로는 이동할 수 없습니다.');
      }
      if (await this.isDescendant(userId, item.id, newParentId)) {
        throw new BadRequestException('하위 폴더로는 이동할 수 없습니다.');
      }
    }
    await this.assertUniqueName(userId, newParentId, item.name, id);
    return this.prisma.driveItem.update({
      where: { id },
      data: { parentId: newParentId },
    });
  }

  private async moveTrashedItem(
    userId: string,
    item: DriveItem,
    newParentId: string | null,
  ) {
    if (isSystemSectionRootFolder(item)) {
      throw new BadRequestException('문서·이미지 루트 폴더는 이동할 수 없습니다.');
    }
    if (newParentId) {
      const parent = await this.assertFolderOwned(userId, newParentId);
      if (parent.id === item.id) {
        throw new BadRequestException('자기 자신으로는 이동할 수 없습니다.');
      }
      if (await this.isDescendant(userId, item.id, newParentId)) {
        throw new BadRequestException('하위 폴더로는 이동할 수 없습니다.');
      }
    }
    await this.assertUniqueName(userId, newParentId, item.name, item.id);

    const subtreeIds = await this.collectTrashSubtreeIds(userId, item.id);
    if (!subtreeIds.length) {
      throw new NotFoundException('항목을 찾을 수 없습니다.');
    }

    await this.prisma.driveItem.updateMany({
      where: { userId, id: { in: subtreeIds } },
      data: { deletedAt: null, purgeAt: null },
    });
    return this.prisma.driveItem.update({
      where: { id: item.id },
      data: { parentId: newParentId },
    });
  }

  /** 휴지통에 있는 항목과 그 자손(삭제된 항목만) id 목록 */
  private async collectTrashSubtreeIds(
    userId: string,
    rootId: string,
  ): Promise<string[]> {
    const root = await this.prisma.driveItem.findFirst({
      where: { id: rootId, userId, deletedAt: { not: null } },
      select: { id: true },
    });
    if (!root) return [];
    const ids: string[] = [root.id];
    const stack: string[] = [root.id];
    while (stack.length) {
      const current = stack.pop()!;
      const children = await this.prisma.driveItem.findMany({
        where: { userId, parentId: current, deletedAt: { not: null } },
        select: { id: true },
      });
      for (const c of children) {
        ids.push(c.id);
        stack.push(c.id);
      }
    }
    return ids;
  }

  async renameItem(userId: string, id: string, rawName: string) {
    await this.purgeExpiredTrash(userId);
    const name = rawName.trim().normalize('NFC');
    if (!name) {
      throw new BadRequestException('이름을 입력해 주세요.');
    }
    const item = await this.prisma.driveItem.findFirst({
      where: { id, userId, deletedAt: null },
    });
    if (!item) {
      throw new NotFoundException('항목을 찾을 수 없습니다.');
    }
    if (name === item.name) {
      return item;
    }
    await this.assertUniqueName(userId, item.parentId, name, id);
    return this.prisma.driveItem.update({
      where: { id },
      data: { name },
    });
  }

  private async isDescendant(
    userId: string,
    ancestorId: string,
    candidateId: string,
  ): Promise<boolean> {
    let current: string | null = candidateId;
    const seen = new Set<string>();
    while (current) {
      if (seen.has(current)) break;
      seen.add(current);
      if (current === ancestorId) return true;
      const parentRow: { parentId: string | null } | null =
        await this.prisma.driveItem.findFirst({
          where: { id: current, userId, deletedAt: null },
          select: { parentId: true },
        });
      current = parentRow?.parentId ?? null;
    }
    return false;
  }

  async getFileForUser(userId: string, id: string, allowDeleted = false): Promise<DriveItem> {
    await this.purgeExpiredTrash(userId);
    const item = await this.prisma.driveItem.findFirst({
      where: {
        id,
        userId,
        type: DriveItemType.FILE,
        ...(allowDeleted ? {} : { deletedAt: null }),
      },
    });
    if (!item || !item.storageKey) {
      throw new NotFoundException('파일을 찾을 수 없습니다.');
    }
    return item;
  }

  async readFileBuffer(userId: string, id: string, allowDeleted = false): Promise<Buffer> {
    const item = await this.getFileForUser(userId, id, allowDeleted);
    const p = this.filePath(userId, item.storageKey!);
    return fs.readFile(p);
  }

  private async assertFolderOwned(
    userId: string,
    folderId: string,
  ): Promise<DriveItem> {
    const folder = await this.prisma.driveItem.findFirst({
      where: { id: folderId, userId, type: DriveItemType.FOLDER, deletedAt: null },
    });
    if (!folder) {
      throw new NotFoundException('폴더를 찾을 수 없습니다.');
    }
    return folder;
  }

  private async assertUniqueName(
    userId: string,
    parentId: string | null,
    name: string,
    excludeId?: string,
  ) {
    const existing = await this.prisma.driveItem.findFirst({
      where: {
        userId,
        parentId,
        name,
        deletedAt: null,
        ...(excludeId ? { NOT: { id: excludeId } } : {}),
      },
    });
    if (existing) {
      throw new ConflictException('같은 위치에 동일한 이름이 있습니다.');
    }
  }
}

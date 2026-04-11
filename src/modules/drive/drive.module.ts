import { Module } from '@nestjs/common';
import { DriveModule as LegacyDriveModule } from '../../drive/drive.module';

@Module({
  imports: [LegacyDriveModule],
  exports: [LegacyDriveModule],
})
export class DriveModule {}

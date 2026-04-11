import { Module } from '@nestjs/common';
import { AuthModule as LegacyAuthModule } from '../../auth/auth.module';

@Module({
  imports: [LegacyAuthModule],
  exports: [LegacyAuthModule],
})
export class AuthModule {}

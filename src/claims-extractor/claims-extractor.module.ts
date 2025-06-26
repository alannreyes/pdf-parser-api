import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ClaimsExtractorController } from './claims-extractor.controller';
import { ClaimsExtractorService } from './claims-extractor.service';
import { ClaimExtract } from '../entities/claim-extract.entity';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([ClaimExtract]),
  ],
  controllers: [ClaimsExtractorController],
  providers: [
    ClaimsExtractorService,
  ],
})
export class ClaimsExtractorModule {} 
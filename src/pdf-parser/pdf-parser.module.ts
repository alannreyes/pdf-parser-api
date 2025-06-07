import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PdfParserController } from './pdf-parser.controller';
import { PdfParserService } from './pdf-parser.service';
import { PdfClassifierService } from './services/pdf-classifier.service';

@Module({
  imports: [ConfigModule],
  controllers: [PdfParserController],
  providers: [
    PdfParserService,
    PdfClassifierService
  ],
})
export class PdfParserModule {}
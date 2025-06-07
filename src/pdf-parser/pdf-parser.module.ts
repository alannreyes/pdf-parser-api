import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PdfParserController } from './pdf-parser.controller';
import { PdfParserService } from './pdf-parser.service';

@Module({
  imports: [ConfigModule],
  controllers: [PdfParserController],
  providers: [PdfParserService],
})
export class PdfParserModule {}
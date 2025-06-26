import {
  Controller,
  Post,
  UseInterceptors,
  UploadedFiles,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiResponse, ApiConsumes } from '@nestjs/swagger';
import { ClaimsExtractorService } from './claims-extractor.service';
import { ExtractClaimsResponseDto } from './dto/extract-claims-response.dto';

@ApiTags('claims-extractor')
@Controller('extract-claims')
export class ClaimsExtractorController {
  private readonly logger = new Logger(ClaimsExtractorController.name);

  constructor(
    private readonly claimsExtractorService: ClaimsExtractorService,
  ) {}

  @Post()
  @UseInterceptors(FilesInterceptor('files', 10))
  @ApiOperation({ 
    summary: 'Extrae claims de documentos legales',
    description: 'Procesa documentos legales y extrae información específica basada en configuraciones de base de datos'
  })
  @ApiConsumes('multipart/form-data')
  @ApiResponse({
    status: 200,
    description: 'Claims extraídos exitosamente',
    type: ExtractClaimsResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Error en la solicitud',
  })
  async extractClaims(
    @UploadedFiles() files: Express.Multer.File[],
  ): Promise<ExtractClaimsResponseDto> {
    this.logger.log(`Recibidos ${files?.length || 0} archivos para procesamiento`);

    if (!files || files.length === 0) {
      throw new BadRequestException('No se proporcionaron archivos');
    }

    try {
      return await this.claimsExtractorService.extractFromDocuments(files);
    } catch (error) {
      this.logger.error('Error procesando documentos:', error);
      throw new BadRequestException('Error procesando documentos: ' + error.message);
    }
  }
} 
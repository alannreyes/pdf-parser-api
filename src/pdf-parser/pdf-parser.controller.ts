import {
  Controller,
  Post,
  UseInterceptors,
  UploadedFile,
  Body,
  HttpException,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiResponse, ApiTags, ApiBody } from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';
import { PdfParserService } from './pdf-parser.service';
import { ParsePdfDto, ParsePdfResponseDto } from './dto/parse-pdf.dto';

@ApiTags('PDF Parser')
@Controller('pdf')
@UseGuards(ThrottlerGuard)
export class PdfParserController {
  constructor(private readonly pdfParserService: PdfParserService) {}

  @Post('parse')
  @UseInterceptors(FileInterceptor('file', {
    limits: {
      fileSize: parseInt(process.env.MAX_FILE_SIZE || '52428800'), // Usar variable de entorno
    },
    fileFilter: (req, file, callback) => {
      if (!file.originalname.match(/\.(pdf)$/)) {
        return callback(new HttpException('Solo se permiten archivos PDF', HttpStatus.BAD_REQUEST), false);
      }
      callback(null, true);
    },
  }))
  @ApiOperation({ summary: 'Parsear PDF y convertir a markdown' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
        instructions: {
          type: 'string',
          description: 'Instrucciones adicionales',
        },
        includeAnalysis: {
          type: 'boolean',
          default: true,
        },
        extractMetadata: {
          type: 'boolean',
          default: true,
        },
        maxTokens: {
          type: 'number',
          default: 4000,
          minimum: 100,
          maximum: 8000,
        },
      },
    },
  })
  @ApiResponse({ 
    status: 200, 
    description: 'PDF procesado exitosamente',
    type: ParsePdfResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Archivo inválido' })
  @ApiResponse({ status: 413, description: 'Archivo demasiado grande' })
  @ApiResponse({ status: 500, description: 'Error del servidor' })
  async parsePdf(
    @UploadedFile() file: Express.Multer.File,
    @Body() parsePdfDto: ParsePdfDto,
  ): Promise<ParsePdfResponseDto> {
    if (!file) {
      throw new HttpException('No se proporcionó ningún archivo', HttpStatus.BAD_REQUEST);
    }

    console.log(`Procesando archivo: ${file.originalname}, tamaño: ${file.size} bytes (${(file.size / 1024 / 1024).toFixed(2)}MB)`);
    const startTime = Date.now();

    try {
      const result = await this.pdfParserService.parsePdf(file.buffer, parsePdfDto);
      
      // El servicio ahora devuelve una respuesta exitosa para PDFs protegidos
      // así que simplemente devolvemos el resultado
      return {
        ...result,
        processingTime: Date.now() - startTime,
        filename: file.originalname,
      };
    } catch (error) {
      // Solo lanzamos excepción para errores reales
      // Los PDFs protegidos ya se manejan en el servicio
      throw new HttpException(
        error.message || 'Error al procesar el PDF',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('parse-url')
  @ApiOperation({ summary: 'Parsear PDF desde URL' })
  @ApiResponse({ 
    status: 200, 
    description: 'PDF procesado exitosamente',
    type: ParsePdfResponseDto,
  })
  async parsePdfFromUrl(
    @Body() body: { url: string } & ParsePdfDto,
  ): Promise<ParsePdfResponseDto> {
    const startTime = Date.now();
    
    try {
      const result = await this.pdfParserService.parsePdfFromUrl(body.url, body);
      
      return {
        ...result,
        processingTime: Date.now() - startTime,
        sourceUrl: body.url,
      };
    } catch (error) {
      throw new HttpException(
        error.message || 'Error al procesar el PDF',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
import { IsOptional, IsString, IsBoolean, IsNumber, Min, Max } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ParsePdfDto {
  @ApiProperty({ 
    description: 'Instrucciones adicionales para el procesamiento',
    required: false 
  })
  @IsOptional()
  @IsString()
  instructions?: string;

  @ApiProperty({ 
    description: 'Incluir análisis detallado del contenido',
    default: true,
    required: false 
  })
  @IsOptional()
  @IsBoolean()
  includeAnalysis?: boolean = true;

  @ApiProperty({ 
    description: 'Extraer metadatos del PDF',
    default: true,
    required: false 
  })
  @IsOptional()
  @IsBoolean()
  extractMetadata?: boolean = true;

  @ApiProperty({ 
    description: 'Máximo de tokens para la respuesta',
    default: 4000,
    minimum: 100,
    maximum: 8000,
    required: false 
  })
  @IsOptional()
  @IsNumber()
  @Min(100)
  @Max(8000)
  maxTokens?: number = 4000;

  // AGREGAR ESTA PROPIEDAD:
  @ApiProperty({ 
    description: 'Usar procesamiento local en lugar de OpenAI',
    default: false,
    required: false 
  })
  @IsOptional()
  @IsBoolean()
  useLocalProcessing?: boolean = false;
}
export class ParsePdfResponseDto {
  @ApiProperty({ description: 'Contenido en formato markdown' })
  markdown: string;

  @ApiProperty({ description: 'Metadatos del PDF', required: false })
  metadata?: {
    title?: string;
    author?: string;
    subject?: string;
    keywords?: string;
    creationDate?: Date;
    modificationDate?: Date;
    pageCount?: number;
  };

  @ApiProperty({ description: 'Análisis del contenido', required: false })
  analysis?: {
    summary?: string;
    mainTopics?: string[];
    keyPoints?: string[];
    language?: string;
  };

  @ApiProperty({ description: 'Tiempo de procesamiento en ms' })
  processingTime: number;
}
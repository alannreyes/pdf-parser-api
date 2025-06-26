import { ApiProperty } from '@nestjs/swagger';

export class ExtractClaimsResponseDto {
  @ApiProperty({
    description: 'Indica si la extracción fue exitosa',
    example: true,
  })
  success: boolean;

  @ApiProperty({
    description: 'Datos extraídos de los documentos procesados',
    example: {
      'nombre_demandante': 'Juan Pérez',
      'fecha_demanda': '2024-01-15',
      'monto_reclamado': '$50,000'
    },
  })
  data: Record<string, any>;

  @ApiProperty({
    description: 'Número de documentos procesados',
    example: 2,
  })
  documentsProcessed: number;

  @ApiProperty({
    description: 'Tiempo de procesamiento en milisegundos',
    example: 3500,
  })
  processingTimeMs: number;

  @ApiProperty({
    description: 'Modelo de IA utilizado',
    example: 'gpt-4o',
  })
  modelUsed: string;

  @ApiProperty({
    description: 'Mensajes de error o advertencias, si los hay',
    required: false,
    type: [String],
  })
  warnings?: string[];
} 
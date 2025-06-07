import { ResultadoClasificacion } from '../types/pdf-types';

export class ParsePdfResponseDto {
  markdown: string;
  clasificacion: ResultadoClasificacion;
  metadata?: any;
  analysis?: any;
  warnings?: Array<{
    tipo: string;
    mensaje: string;
    calidadTexto?: string;
  }>;
}
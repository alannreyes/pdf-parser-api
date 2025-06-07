import { Injectable } from '@nestjs/common';
import { ExtractionStrategy } from './extraction-strategy.interface';
import { TipoPDF } from '../types/pdf-types';

@Injectable()
export class OcrExtractionStrategy implements ExtractionStrategy {
  async extract(buffer: Buffer): Promise<string> {
    // Aquí implementarías la lógica de OCR
    // Por ahora, un placeholder
    console.log('OCR requerido para este PDF');
    return 'OCR no implementado aún';
  }

  canHandle(tipo: string): boolean {
    return tipo === TipoPDF.ESCANEADO || tipo === TipoPDF.MIXTO;
  }
}
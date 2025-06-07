import { Injectable } from '@nestjs/common';
import * as pdf from 'pdf-parse';
import { ExtractionStrategy } from './extraction-strategy.interface';
import { TipoPDF } from '../types/pdf-types';

@Injectable()
export class NativeExtractionStrategy implements ExtractionStrategy {
  async extract(buffer: Buffer): Promise<string> {
    const data = await pdf(buffer);
    return data.text;
  }

  canHandle(tipo: string): boolean {
    return tipo === TipoPDF.NATIVO;
  }
}
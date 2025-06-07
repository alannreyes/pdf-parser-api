import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as pdfParse from 'pdf-parse';
import OpenAI from 'openai';
import { ParsePdfDto } from './dto/parse-pdf.dto';

@Injectable()
export class PdfParserService {
  private openai: OpenAI;

  constructor(private configService: ConfigService) {
    this.openai = new OpenAI({
      apiKey: this.configService.get('openai.apiKey'),
    });
  }

  async parsePdf(buffer: Buffer, options: ParsePdfDto) {
    try {
      // Extraer texto del PDF
      const pdfData = await pdfParse(buffer);
      
      const result: any = {
        markdown: '',
      };

      // Extraer metadatos si se solicita
      if (options.extractMetadata) {
        result.metadata = this.extractMetadata(pdfData);
      }

      // Convertir a markdown usando GPT-4o
      const markdown = await this.convertToMarkdown(pdfData.text, options);
      result.markdown = markdown;

      // Realizar análisis si se solicita
      if (options.includeAnalysis) {
        result.analysis = await this.analyzePdfContent(pdfData.text, options);
      }

      return result;
    } catch (error) {
      console.error('Error parsing PDF:', error);
      throw new HttpException(
        'Error al procesar el PDF: ' + error.message,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async parsePdfFromUrl(url: string, options: ParsePdfDto) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Error al descargar PDF: ${response.statusText}`);
      }
      
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      
      return this.parsePdf(buffer, options);
    } catch (error) {
      throw new HttpException(
        'Error al descargar o procesar el PDF desde URL',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  private async convertToMarkdown(text: string, options: ParsePdfDto): Promise<string> {
    const systemPrompt = `Eres un experto en convertir texto de PDF a formato markdown bien estructurado. 
    Tu tarea es tomar el texto extraído y formatearlo correctamente en markdown, preservando:
    - Estructura jerárquica (títulos, subtítulos)
    - Listas y enumeraciones
    - Tablas (si las hay)
    - Énfasis (negrita, cursiva)
    - Enlaces (si los hay)
    - Bloques de código (si los hay)
    
    Mantén el contenido fiel al original pero mejora la legibilidad y estructura.`;

    const userPrompt = `Convierte el siguiente texto de PDF a formato markdown bien estructurado:
    
    ${options.instructions ? `Instrucciones adicionales: ${options.instructions}\n\n` : ''}
    
    Texto del PDF:
    ${text}`;

    try {
      const completion = await this.openai.chat.completions.create({
        model: this.configService.get('openai.model'),
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: options.maxTokens || 4000,
        temperature: 0.3,
      });

      return completion.choices[0].message.content;
    } catch (error) {
      console.error('OpenAI API error:', error);
      throw new HttpException(
        'Error al procesar con OpenAI',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  private async analyzePdfContent(text: string, options: ParsePdfDto) {
    const systemPrompt = `Analiza el siguiente contenido de PDF y proporciona:
    1. Un resumen conciso
    2. Los temas principales
    3. Los puntos clave
    4. El idioma del documento
    
    Responde en formato JSON.`;

    try {
      const completion = await this.openai.chat.completions.create({
        model: this.configService.get('openai.model'),
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: text.substring(0, 8000) }, // Limitar texto para análisis
        ],
        max_tokens: 1000,
        temperature: 0.3,
        response_format: { type: "json_object" },
      });

      const analysis = JSON.parse(completion.choices[0].message.content);
      
      return {
        summary: analysis.summary || '',
        mainTopics: analysis.mainTopics || [],
        keyPoints: analysis.keyPoints || [],
        language: analysis.language || 'unknown',
      };
    } catch (error) {
      console.error('Error analyzing content:', error);
      return null;
    }
  }

  private extractMetadata(pdfData: any) {
    return {
      title: pdfData.info?.Title || null,
      author: pdfData.info?.Author || null,
      subject: pdfData.info?.Subject || null,
      keywords: pdfData.info?.Keywords || null,
      creationDate: pdfData.info?.CreationDate || null,
      modificationDate: pdfData.info?.ModDate || null,
      pageCount: pdfData.numpages || null,
    };
  }
}
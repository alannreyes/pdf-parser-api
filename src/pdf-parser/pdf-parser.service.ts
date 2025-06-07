import { Injectable, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as pdfParse from 'pdf-parse';
import OpenAI from 'openai';
import { ParsePdfDto } from './dto/parse-pdf.dto';
import { PdfClassifierService } from './services/pdf-classifier.service';
import { TipoPDF } from './types/pdf-types';

@Injectable()
export class PdfParserService {
  private openai: OpenAI;
  private readonly logger = new Logger(PdfParserService.name);

  constructor(
    private configService: ConfigService,
    private pdfClassifier: PdfClassifierService,
  ) {
    this.openai = new OpenAI({
      apiKey: this.configService.get('openai.apiKey'),
    });
  }

  async parsePdf(buffer: Buffer, options: ParsePdfDto) {
    try {
      // Primero clasificar el PDF
      const clasificacion = await this.pdfClassifier.clasificarPDF(buffer);
      
      // Validar si el PDF puede ser procesado
      this.validarProcesamiento(clasificacion);

      // Extraer texto del PDF
      const pdfData = await pdfParse(buffer);
      
      const result: any = {
        markdown: '',
        clasificacion: clasificacion, // Incluir información de clasificación
      };

      // Extraer metadatos si se solicita
      if (options.extractMetadata) {
        result.metadata = this.extractMetadata(pdfData);
      }

      // Si el PDF requiere OCR, incluir advertencia
      if (clasificacion.requiereOCR) {
        result.warnings = result.warnings || [];
        result.warnings.push({
          tipo: 'OCR_REQUERIDO',
          mensaje: `Este PDF es de tipo ${clasificacion.tipo} y puede requerir OCR para mejor extracción`,
          calidadTexto: clasificacion.calidadTexto
        });
      }

      // Adaptar el prompt según el tipo de PDF
      const markdown = await this.convertToMarkdown(
        pdfData.text, 
        options,
        clasificacion
      );
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

  private validarProcesamiento(clasificacion: any) {
    if (clasificacion.tipo === TipoPDF.PROTEGIDO) {
      throw new HttpException(
        'El PDF está protegido y no puede ser procesado',
        HttpStatus.FORBIDDEN,
      );
    }

    if (clasificacion.tipo === TipoPDF.ESCANEADO && clasificacion.cantidadTexto === 0) {
      this.logger.warn('PDF escaneado sin texto detectado - se requiere OCR');
    }
  }

private async convertToMarkdown(
  text: string, 
  options: ParsePdfDto,
  clasificacion: any
): Promise<string> {
  // Adaptar el prompt según el tipo de PDF
  let promptAdicional = '';
  
  if (clasificacion.tipo === TipoPDF.MIXTO) {
    promptAdicional = '\nNOTA: Este PDF parece ser un documento mixto con posible texto de OCR. Ten en cuenta posibles errores de reconocimiento.';
  } else if (clasificacion.tipo === TipoPDF.FORMULARIO) {
    promptAdicional = '\nNOTA: Este PDF contiene formularios. Intenta preservar la estructura de los campos del formulario.';
  }

  // AGREGAR ESTA PARTE PARA USAR LA CALIDAD DEL TEXTO
  if (clasificacion.calidadTexto === 'baja') {
    promptAdicional += '\nNOTA: La calidad del texto extraído es baja. Puede haber errores de OCR o caracteres mal reconocidos.';
  } else if (clasificacion.calidadTexto === 'sin_texto') {
    promptAdicional += '\nNOTA: No se detectó texto en el PDF original. El contenido puede estar incompleto.';
  }

  const systemPrompt = `Eres un experto en convertir texto de PDF a formato markdown bien estructurado. 
  Tu tarea es tomar el texto extraído y formatearlo correctamente en markdown, preservando:
  - Estructura jerárquica (títulos, subtítulos)
  - Listas y enumeraciones
  - Tablas (si las hay)
  - Énfasis (negrita, cursiva)
  - Enlaces (si los hay)
  - Bloques de código (si los hay)
  
  Mantén el contenido fiel al original pero mejora la legibilidad y estructura.${promptAdicional}`;
}
    const userPrompt = `Convierte el siguiente texto de PDF a formato markdown bien estructurado:
    
    ${options.instructions ? `Instrucciones adicionales: ${options.instructions}\n\n` : ''}
    
    Texto del PDF:
    ${text}`;

    try {
      const completion = await this.openai.chat.completions.create({
        model: this.configService.get<string>('openai.model') || 'gpt-4o',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: options.maxTokens || 4000,
        temperature: 0.3,
      });

      return completion.choices[0].message.content || '';
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
        model: this.configService.get<string>('openai.model') || 'gpt-4o',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: text.substring(0, 8000) },
        ],
        max_tokens: 1000,
        temperature: 0.3,
        response_format: { type: "json_object" },
      });

      const content = completion.choices[0].message.content;
      if (!content) {
        return null;
      }
      const analysis = JSON.parse(content);
      
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
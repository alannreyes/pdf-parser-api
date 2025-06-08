import { Injectable, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as pdfParse from 'pdf-parse';
import OpenAI from 'openai';
import PQueue from 'p-queue';
import { ParsePdfDto } from './dto/parse-pdf.dto';
import { PdfClassifierService } from './services/pdf-classifier.service';
import { TipoPDF } from './types/pdf-types';

@Injectable()
export class PdfParserService {
  private openai: OpenAI;
  private readonly logger = new Logger(PdfParserService.name);
  private queue: PQueue;

  constructor(
    private configService: ConfigService,
    private pdfClassifier: PdfClassifierService,
  ) {
    this.openai = new OpenAI({
      apiKey: this.configService.get('openai.apiKey'),
    });

    // Configurar la cola con límites de rate
    const rateLimit = parseInt(this.configService.get('OPENAI_RATE_LIMIT_RPM', '30'), 10);
    this.queue = new PQueue({
      concurrency: 1, // Procesar una petición a la vez
      interval: 60000, // Por minuto
      intervalCap: rateLimit, // Máximo de peticiones por minuto
    });

    this.logger.log(`Configurado rate limit de OpenAI: ${rateLimit} RPM`);
  }

  // Método auxiliar para llamadas a OpenAI con reintentos
  private async callOpenAIWithRetry(apiCall: () => Promise<any>): Promise<any> {
    const maxRetries = parseInt(this.configService.get('OPENAI_MAX_RETRIES', '3'), 10);
    const retryDelay = parseInt(this.configService.get('OPENAI_RETRY_DELAY', '2000'), 10);

    return this.queue.add(async () => {
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
          this.logger.debug(`Llamando a OpenAI (intento ${attempt + 1}/${maxRetries})`);
          return await apiCall();
        } catch (error) {
          this.logger.error(`Error en OpenAI (intento ${attempt + 1}/${maxRetries}):`, error.message);
          
          if (error.status === 429) {
            // Rate limit error - esperar más tiempo
            const waitTime = Math.pow(2, attempt) * retryDelay;
            this.logger.warn(`Rate limit alcanzado, esperando ${waitTime}ms antes de reintentar`);
            
            if (attempt < maxRetries - 1) {
              await new Promise(resolve => setTimeout(resolve, waitTime));
              continue;
            }
          }
          
          if (attempt === maxRetries - 1) {
            // Último intento falló
            throw error;
          }
          
          // Para otros errores, esperar antes de reintentar
          await new Promise(resolve => setTimeout(resolve, retryDelay));
        }
      }
    });
  }

  async parsePdf(buffer: Buffer, options: ParsePdfDto) {
    try {
      // Primero clasificar el PDF
      const clasificacion = await this.pdfClassifier.clasificarPDF(buffer);
      
      // Si el PDF está protegido, devolver respuesta especial en lugar de lanzar error
      if (clasificacion.tipo === TipoPDF.PROTEGIDO) {
        this.logger.warn('PDF protegido detectado, devolviendo respuesta especial');
        return {
          markdown: '',
          clasificacion: clasificacion,
          metadata: {
            title: 'PDF Protegido',
            author: null,
            subject: null,
            keywords: null,
            creationDate: null,
            modificationDate: null,
            pageCount: 0,
            isProtected: true,
            protectionType: 'password_protected'
          },
          analysis: {
            summary: 'Este PDF está protegido con contraseña y no puede ser procesado',
            mainTopics: [],
            keyPoints: ['PDF protegido', 'Requiere contraseña'],
            language: 'unknown',
            error: 'PDF_PROTECTED'
          },
          warnings: [{
            tipo: 'PDF_PROTEGIDO',
            mensaje: 'El PDF está protegido y no puede ser procesado sin la contraseña',
            severidad: 'alta'
          }],
          success: false,
          error: 'PDF_PROTECTED'
        };
      }

      // Validar otros casos de procesamiento
      this.validarProcesamiento(clasificacion);

      // Extraer texto del PDF
      const pdfData = await pdfParse(buffer);
      
      const result: any = {
        markdown: '',
        clasificacion: clasificacion,
        success: true
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
      // Si es un error de PDF protegido que no fue capturado antes
      if (error.message?.toLowerCase().includes('encrypt') || 
          error.message?.toLowerCase().includes('password') ||
          error.message?.toLowerCase().includes('protegido')) {
        this.logger.warn('PDF protegido detectado en catch block');
        return {
          markdown: '',
          metadata: {
            isProtected: true,
            error: 'PDF_PROTECTED'
          },
          analysis: {
            summary: 'PDF protegido - no se puede procesar',
            error: 'PDF_PROTECTED'
          },
          success: false,
          error: 'PDF_PROTECTED',
          errorMessage: error.message
        };
      }

      // Para otros errores, mantener el comportamiento actual
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
    // Ya no lanzamos excepción para PDFs protegidos aquí
    // porque se maneja arriba
    
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

    const userPrompt = `Convierte el siguiente texto de PDF a formato markdown bien estructurado:
    
    ${options.instructions ? `Instrucciones adicionales: ${options.instructions}\n\n` : ''}
    
    Texto del PDF:
    ${text}`;

    try {
      // Usar el método con reintentos
      return await this.callOpenAIWithRetry(async () => {
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
      });
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
      // Usar el método con reintentos
      return await this.callOpenAIWithRetry(async () => {
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
      });
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
import { Injectable, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as pdfParse from 'pdf-parse';
import OpenAI from 'openai';
import PQueue from 'p-queue';
import { ParsePdfDto } from './dto/parse-pdf.dto';
import { PdfClassifierService } from './services/pdf-classifier.service';
import { TipoPDF, ResultadoClasificacion } from './types/pdf-types';

@Injectable()
export class PdfParserService {
  private openai: OpenAI;
  private readonly logger = new Logger(PdfParserService.name);
  private queue: PQueue;
  
  // Propiedades de configuración
  private openAIEnabled: boolean;
  private fallbackToLocal: boolean;
  private maxTextLength: number;
  private useForSimplePdfsOnly: boolean;
  private localProcessingDefault: boolean;
  private localProcessingForComplex: boolean;

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
      concurrency: 1,
      interval: 60000,
      intervalCap: rateLimit,
    });

    this.logger.log(`Configurado rate limit de OpenAI: ${rateLimit} RPM`);
    
    // Inicializar configuraciones
    this.openAIEnabled = this.configService.get('OPENAI_ENABLED', 'true') === 'true';
    this.fallbackToLocal = this.configService.get('OPENAI_FALLBACK_TO_LOCAL', 'true') === 'true';
    this.maxTextLength = parseInt(this.configService.get('OPENAI_MAX_TEXT_LENGTH', '30000'), 10);
    this.useForSimplePdfsOnly = this.configService.get('OPENAI_USE_FOR_SIMPLE_PDFS_ONLY', 'true') === 'true';
    this.localProcessingDefault = this.configService.get('LOCAL_PROCESSING_DEFAULT', 'false') === 'true';
    this.localProcessingForComplex = this.configService.get('LOCAL_PROCESSING_FOR_COMPLEX_PDFS', 'true') === 'true';
    
    this.logger.log(`Configuración: OpenAI=${this.openAIEnabled}, FallbackLocal=${this.fallbackToLocal}, MaxText=${this.maxTextLength}`);
  }

  // Método auxiliar para llamadas a OpenAI con reintentos
  private async callOpenAIWithRetry(apiCall: () => Promise<any>): Promise<any> {
    const maxRetries = parseInt(this.configService.get('OPENAI_MAX_RETRIES', '3'), 10);
    const retryDelay = parseInt(this.configService.get('OPENAI_RETRY_DELAY', '2000'), 10);

    return this.queue.add(async () => {
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
          
          return await apiCall();
        } catch (error) {
          this.logger.error(`Error en OpenAI (intento ${attempt + 1}/${maxRetries}):`, error.message);
          
          if (error.status === 429) {
            const waitTime = Math.pow(2, attempt) * retryDelay;
            this.logger.warn(`Rate limit alcanzado, esperando ${waitTime}ms antes de reintentar`);
            
            if (attempt < maxRetries - 1) {
              await new Promise(resolve => setTimeout(resolve, waitTime));
              continue;
            }
          }
          
          if (attempt === maxRetries - 1) {
            throw error;
          }
          
          await new Promise(resolve => setTimeout(resolve, retryDelay));
        }
      }
    });
  }

  async parsePdf(buffer: Buffer, options: ParsePdfDto) {
    try {
      const startTime = Date.now();
      
      // Primero clasificar el PDF
      const clasificacion = await this.pdfClassifier.clasificarPDF(buffer);
      
      // Si el PDF está protegido, devolver respuesta especial
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
          error: 'PDF_PROTECTED',
          processingTime: Date.now() - startTime
        };
      }

      // Validar otros casos de procesamiento
      this.validarProcesamiento(clasificacion);

      // Extraer texto del PDF
      const pdfData = await pdfParse(buffer);
      
      // Determinar si usar procesamiento local
      const useLocalProcessing = this.shouldUseLocalProcessing(
        clasificacion, 
        pdfData.text, 
        options
      );
      
      this.logger.log(`Procesando PDF: Tipo=${clasificacion.tipo}, Método=${useLocalProcessing ? 'LOCAL' : 'GPT'}, TextoLength=${pdfData.text.length}`);
      
      const result: any = {
        markdown: '',
        clasificacion: clasificacion,
        success: true,
        processingMethod: useLocalProcessing ? 'local' : 'gpt'
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

      // Convertir a markdown
      if (useLocalProcessing) {
        this.logger.log('Usando procesamiento local para markdown');
        result.markdown = await this.processLocalMarkdown(pdfData.text, clasificacion);
      } else {
        try {
          this.logger.log('Usando GPT para markdown');
          result.markdown = await this.convertToMarkdown(pdfData.text, options, clasificacion);
        } catch (error) {
          if (this.fallbackToLocal) {
            this.logger.warn('Error con GPT, usando procesamiento local como fallback', error.message);
            result.markdown = await this.processLocalMarkdown(pdfData.text, clasificacion);
            result.processingMethod = 'local_fallback';
            result.warnings = result.warnings || [];
            result.warnings.push({
              tipo: 'GPT_FALLBACK',
              mensaje: 'Se usó procesamiento local debido a error con GPT',
              error: error.message
            });
          } else {
            throw error;
          }
        }
      }

      // Realizar análisis si se solicita
      if (options.includeAnalysis) {
        if (useLocalProcessing) {
          this.logger.log('Usando análisis local');
          result.analysis = await this.analyzeContentLocally(pdfData.text, clasificacion);
        } else {
          try {
            this.logger.log('Usando GPT para análisis');
            result.analysis = await this.analyzePdfContent(pdfData.text, options);
          } catch (error) {
            if (this.fallbackToLocal) {
              this.logger.warn('Error analizando con GPT, usando análisis local', error.message);
              result.analysis = await this.analyzeContentLocally(pdfData.text, clasificacion);
            } else {
              result.analysis = null;
            }
          }
        }
      }

      result.processingTime = Date.now() - startTime;
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

  // Determinar si usar procesamiento local
  private shouldUseLocalProcessing(
    clasificacion: ResultadoClasificacion, 
    text: string, 
    options: ParsePdfDto
  ): boolean {
    // Si OpenAI está deshabilitado globalmente
    if (!this.openAIEnabled) {
      
      return true;
    }
    
    // Si se solicita específicamente procesamiento local
    if (options.useLocalProcessing) {
      
      return true;
    }
    
    // Si el default es usar procesamiento local
    if (this.localProcessingDefault) {
      
      return true;
    }
    
    // Para PDFs complejos, usar local si está configurado
    if (this.localProcessingForComplex) {
      // PDFs protegidos siempre local
      if (clasificacion.tipo === TipoPDF.PROTEGIDO) {
      
        return true;
      }
      
      // PDFs escaneados sin texto
      if (clasificacion.tipo === TipoPDF.ESCANEADO && (!text || text.length === 0)) {
      
        return true;
      }
      
      // PDFs con calidad de texto muy baja
      if (clasificacion.calidadTexto === 'baja' || clasificacion.calidadTexto === 'sin_texto') {
      
        return true;
      }
      
      // Textos muy largos que pueden causar timeout
      if (text.length > this.maxTextLength) {
      
        return true;
      }
      
      // PDFs mixtos con OCR problemático
      if (clasificacion.tipo === TipoPDF.MIXTO && clasificacion.requiereOCR) {
      
        return true;
      }
    }
    
    // Si solo usar GPT para PDFs simples
    if (this.useForSimplePdfsOnly) {
      const useGPT = clasificacion.tipo === TipoPDF.NATIVO && 
                     clasificacion.calidadTexto === 'alta' &&
                     text.length < this.maxTextLength;
      
      
      return !useGPT;
    }
    
    return false;
  }

  // Procesamiento local de markdown
  private async processLocalMarkdown(text: string, clasificacion: ResultadoClasificacion): Promise<string> {
    if (!text || text.trim().length === 0) {
      return `# Documento sin texto extraíble\n\nTipo: ${clasificacion.tipo}\nPáginas: ${clasificacion.numeroPaginas}`;
    }

    // Para documentos de seguros como el ejemplo problemático
    if (this.isInsuranceDocument(text)) {
      return this.processInsuranceDocument(text);
    }

    // Para formularios
    if (clasificacion.tipo === TipoPDF.FORMULARIO) {
      return this.processFormDocument(text);
    }

    // Procesamiento general
    return this.processGeneralDocument(text, clasificacion);
  }

  // Procesador específico para documentos de seguros
  private processInsuranceDocument(text: string): string {
    const lines = text.split('\n').map(l => l.trim()).filter(l => l);
    let markdown = '# Documento de Seguro/Póliza\n\n';
    
    // Extraer información clave
    const policyInfo: string[] = [];
    const coverageInfo: string[] = [];
    const contactInfo: string[] = [];
    const generalText: string[] = [];
    
    for (const line of lines) {
      if (/Policy\s*Number|Claim\s*Number|Insured|Policy\s*Period/i.test(line)) {
        policyInfo.push(line);
      } else if (/Coverage|Premium|Deductible|Limit|\$[\d,]+/i.test(line)) {
        coverageInfo.push(line);
      } else if (/Phone|Email|Address|Contact/i.test(line)) {
        contactInfo.push(line);
      } else if (line.length > 10) {
        generalText.push(line);
      }
    }
    
    // Sección de información de póliza
    if (policyInfo.length > 0) {
      markdown += '## Información de la Póliza\n\n';
      policyInfo.forEach(info => {
        if (info.includes(':')) {
          const [key, value] = info.split(':');
          markdown += `**${key.trim()}:** ${value.trim()}\n\n`;
        } else {
          markdown += `${info}\n\n`;
        }
      });
    }
    
    // Sección de coberturas
    if (coverageInfo.length > 0) {
      markdown += '## Coberturas y Límites\n\n';
      coverageInfo.forEach(info => {
        if (info.includes('$')) {
          markdown += `💰 ${info}\n`;
        } else {
          markdown += `- ${info}\n`;
        }
      });
      markdown += '\n';
    }
    
    // Información de contacto
    if (contactInfo.length > 0) {
      markdown += '## Información de Contacto\n\n';
      contactInfo.forEach(info => {
        markdown += `📞 ${info}\n`;
      });
      markdown += '\n';
    }
    
    // Texto general (limitado)
    if (generalText.length > 0) {
      markdown += '## Detalles Adicionales\n\n';
      markdown += generalText.slice(0, 20).join('\n\n');
    }
    
    return markdown;
  }

  // Procesador para formularios
  private processFormDocument(text: string): string {
    const lines = text.split('\n').map(l => l.trim()).filter(l => l);
    let markdown = '# Formulario\n\n';
    
    let currentSection = '';
    
    for (const line of lines) {
      // Detectar secciones
      if (line.length < 50 && line === line.toUpperCase() && /[A-Z]/.test(line)) {
        currentSection = line;
        markdown += `\n## ${line}\n\n`;
      }
      // Detectar campos de formulario
      else if (line.includes(':') || line.includes('___') || line.includes('[ ]')) {
        markdown += `📝 ${line}\n`;
      }
      // Texto normal
      else if (line.length > 10) {
        markdown += `${line}\n\n`;
      }
    }
    
    return markdown;
  }

  // Procesamiento general para otros documentos
  private processGeneralDocument(text: string, clasificacion: ResultadoClasificacion): string {
    const lines = text.split('\n').map(l => l.trim()).filter(l => l);
    let markdown = '';
    
    // Metadata del documento
    markdown += `<!-- Procesado localmente -->\n`;
    markdown += `<!-- Tipo: ${clasificacion.tipo}, Calidad: ${clasificacion.calidadTexto} -->\n\n`;
    
    let inList = false;
    let paragraphBuffer = '';
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const nextLine = lines[i + 1] || '';
      
      // Detectar títulos
      if (this.isLikelyTitle(line, nextLine)) {
        if (paragraphBuffer) {
          markdown += paragraphBuffer + '\n\n';
          paragraphBuffer = '';
        }
        if (inList) {
          markdown += '\n';
          inList = false;
        }
        markdown += `\n## ${line}\n\n`;
      }
      // Detectar campos clave:valor
      else if (line.includes(':') && line.indexOf(':') < 50 && line.indexOf(':') > 2) {
        const [key, ...valueParts] = line.split(':');
        const value = valueParts.join(':').trim();
        if (key && value) {
          if (paragraphBuffer) {
            markdown += paragraphBuffer + '\n\n';
            paragraphBuffer = '';
          }
          markdown += `**${key.trim()}:** ${value}\n\n`;
        }
      }
      // Detectar listas
      else if (this.isBulletPoint(line)) {
        if (paragraphBuffer) {
          markdown += paragraphBuffer + '\n\n';
          paragraphBuffer = '';
        }
        if (!inList) {
          inList = true;
        }
        markdown += `- ${line.replace(/^[\•\-\*\►\▪\d+\.]\s*/, '')}\n`;
      }
      // Texto normal - agrupar en párrafos
      else {
        if (inList) {
          markdown += '\n';
          inList = false;
        }
        
        if (line.length > 40) {
          if (paragraphBuffer) {
            paragraphBuffer += ' ' + line;
          } else {
            paragraphBuffer = line;
          }
          
          // Si el siguiente línea parece ser un nuevo párrafo, cerrar el actual
          if (!nextLine || nextLine.length < 40 || this.isLikelyTitle(nextLine, '')) {
            markdown += paragraphBuffer + '\n\n';
            paragraphBuffer = '';
          }
        } else {
          if (paragraphBuffer) {
            markdown += paragraphBuffer + '\n\n';
            paragraphBuffer = '';
          }
          markdown += line + '\n\n';
        }
      }
    }
    
    // Agregar cualquier texto pendiente
    if (paragraphBuffer) {
      markdown += paragraphBuffer + '\n\n';
    }
    
    return markdown.trim();
  }

  // Análisis local del contenido
  private async analyzeContentLocally(text: string, clasificacion: ResultadoClasificacion): Promise<any> {
    const lines = text.split('\n').filter(l => l.trim());
    
    // Detectar tipo de documento
    const documentType = this.detectDocumentType(text);
    
    // Extraer datos según el tipo
    let extractedData = {};
    if (documentType === 'insurance') {
      extractedData = this.extractInsuranceData(text);
    }
    
    // Generar resumen
    const summary = this.generateSummary(lines, documentType);
    
    // Extraer puntos clave
    const keyPoints = this.extractKeyPoints(text, documentType);
    
    // Detectar temas principales
    const mainTopics = this.extractMainTopics(text, documentType);
    
    return {
      summary,
      mainTopics,
      keyPoints,
      language: this.detectLanguage(text),
      documentType,
      extractedData,
      processingMethod: 'local',
      confidence: clasificacion.calidadTexto === 'alta' ? 'high' : 'medium'
    };
  }

  // Métodos auxiliares
  private isInsuranceDocument(text: string): boolean {
    const insuranceKeywords = ['policy', 'coverage', 'claim', 'insured', 'premium', 'deductible', 'farmers'];
    const lowerText = text.toLowerCase();
    const matches = insuranceKeywords.filter(kw => lowerText.includes(kw));
    return matches.length >= 3;
  }

  private extractInsuranceData(text: string): any {
    const data: any = {};
    
    const patterns = {
      policyNumber: /Policy\s*(?:Number|#|No\.?)[\s:]*([A-Z0-9\-]+)/i,
      claimNumber: /Claim\s*(?:Number|#|No\.?)[\s:]*([A-Z0-9\-]+)/i,
      insured: /Insured[\s:]*([^\n]+)/i,
      effectiveDate: /Effective[\s:]*([^\n]+)/i,
      expirationDate: /Expiration[\s:]*([^\n]+)/i,
      premium: /Premium[\s:]*\$?([\d,]+(?:\.\d{2})?)/i,
      coverage: /Coverage\s*[A-Z]?[\s:]*\$?([\d,]+)/gi
    };
    
    for (const [key, pattern] of Object.entries(patterns)) {
      const match = text.match(pattern);
      if (match) {
        data[key] = match[1].trim();
      }
    }
    
    // Buscar todas las coberturas
    const coverageMatches = text.matchAll(/Coverage\s*([A-Z])?[\s:\-]*(?:.*?)\$?([\d,]+)/gi);
    data.coverages = [];
    for (const match of coverageMatches) {
      data.coverages.push({
        type: match[1] || 'General',
        amount: match[2]
      });
    }
    
    return data;
  }

  private generateSummary(lines: string[], documentType: string): string {
    // Tomar las primeras líneas significativas
    const significantLines = lines.filter(l => l.length > 20 && !this.isBulletPoint(l));
    
    switch (documentType) {
      case 'insurance':
        return 'Documento de póliza de seguro con información de coberturas y límites.';
      case 'invoice':
        return 'Factura o documento de cobro con detalles de pagos.';
      case 'contract':
        return 'Documento contractual con términos y condiciones.';
      default:
        const preview = significantLines.slice(0, 3).join(' ');
        return preview.length > 200 ? preview.substring(0, 200) + '...' : preview;
    }
  }

  private extractKeyPoints(text: string, documentType: string): string[] {
    const lines = text.split('\n').filter(l => l.trim());
    const keyPoints: string[] = [];
    
    // Buscar líneas con información importante
    const importantPatterns = [
      /\$[\d,]+/,           // Montos
      /\d{1,2}\/\d{1,2}\/\d{2,4}/,  // Fechas
      /Policy|Claim|Invoice|Contract/i,  // Identificadores
      /Total|Premium|Coverage|Payment/i,  // Términos clave
      /[A-Z0-9]{6,}/       // Códigos
    ];
    
    for (const line of lines) {
      if (keyPoints.length >= 5) break;
      
      for (const pattern of importantPatterns) {
        if (pattern.test(line) && line.length < 100) {
          keyPoints.push(line.trim());
          break;
        }
      }
    }
    
    return keyPoints;
  }

  private extractMainTopics(text: string, documentType: string): string[] {
    // Palabras clave por tipo de documento
    const topicKeywords: Record<string, string[]> = {
      insurance: ['coverage', 'policy', 'premium', 'deductible', 'claim', 'liability'],
      invoice: ['payment', 'amount', 'due', 'invoice', 'bill', 'total'],
      contract: ['agreement', 'terms', 'conditions', 'party', 'obligations'],
      general: []
    };
    
    const keywords = topicKeywords[documentType] || topicKeywords.general;
    const topics: string[] = [];
    
    // Buscar temas basados en keywords
    for (const keyword of keywords) {
      if (text.toLowerCase().includes(keyword)) {
        topics.push(keyword.charAt(0).toUpperCase() + keyword.slice(1));
      }
    }
    
    // Si no hay suficientes temas, extraer palabras frecuentes
    if (topics.length < 3) {
      const words = text.toLowerCase().split(/\s+/).filter(w => w.length > 5);
      const freq: Record<string, number> = {};
      
      words.forEach(word => {
        const clean = word.replace(/[^a-z]/g, '');
        if (clean.length > 5 && !this.isStopWord(clean)) {
          freq[clean] = (freq[clean] || 0) + 1;
        }
      });
      
      const topWords = Object.entries(freq)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 5 - topics.length)
        .map(([word]) => word.charAt(0).toUpperCase() + word.slice(1));
      
      topics.push(...topWords);
    }
    
    return topics.slice(0, 5);
  }

  private isLikelyTitle(line: string, nextLine: string): boolean {
    if (line.length > 60 || line.length < 3) return false;
    
    // Líneas en mayúsculas
    if (line === line.toUpperCase() && /[A-Z]/.test(line)) return true;
    
    // Patrones comunes de títulos
    if (/^(SECTION|ARTICLE|CHAPTER|PART|COVERAGE)\s+/i.test(line)) return true;
    
    // Numeración
    if (/^\d+\.?\s+[A-Z]/.test(line)) return true;
    
    return false;
  }

  private isBulletPoint(line: string): boolean {
    return /^[\•\-\*\►\▪\◦]\s/.test(line) || 
           /^\d+\.\s/.test(line) ||
           /^[a-z]\)\s/i.test(line);
  }

  private detectLanguage(text: string): string {
    const spanishWords = (text.match(/\b(el|la|de|que|en|por|para|con|una|los|las|del|al)\b/gi) || []).length;
    const englishWords = (text.match(/\b(the|is|at|of|and|to|in|for|with|that|this|from)\b/gi) || []).length;
    
    if (spanishWords > englishWords * 1.5) return 'es';
    if (englishWords > spanishWords * 1.5) return 'en';
    return 'unknown';
  }

  private detectDocumentType(text: string): string {
    const lowerText = text.toLowerCase();
    
    if (/policy|premium|coverage|claim|insured|deductible/i.test(text)) return 'insurance';
    if (/invoice|bill|payment|due|total|amount/i.test(text)) return 'invoice';
    if (/contract|agreement|terms|conditions|party/i.test(text)) return 'contract';
    if (/check|cheque|pay to|amount|dollars/i.test(text)) return 'check';
    
    return 'general';
  }

  private isStopWord(word: string): boolean {
    const stopWords = new Set([
      'the', 'is', 'at', 'of', 'and', 'to', 'in', 'for', 'with', 'that',
      'this', 'from', 'by', 'on', 'are', 'was', 'were', 'been', 'have',
      'has', 'had', 'will', 'would', 'could', 'should', 'may', 'might'
    ]);
    return stopWords.has(word);
  }

  // Métodos existentes sin cambios
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
    if (clasificacion.tipo === TipoPDF.ESCANEADO && clasificacion.cantidadTexto === 0) {
      this.logger.warn('PDF escaneado sin texto detectado - se requiere OCR');
    }
  }

  private async convertToMarkdown(
    text: string, 
    options: ParsePdfDto,
    clasificacion: any
  ): Promise<string> {
    // Tu código existente sin cambios
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
      return await this.callOpenAIWithRetry(async () => {
        const completion = await this.openai.chat.completions.create({
          model: this.configService.get<string>('OPENAI_MODEL') || 'gpt-4o',
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
      return await this.callOpenAIWithRetry(async () => {
        const completion = await this.openai.chat.completions.create({
          model: this.configService.get<string>('OPENAI_MODEL') || 'gpt-4o',
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
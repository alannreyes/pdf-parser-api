import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import * as pdfParse from 'pdf-parse';
import { ClaimExtract } from '../entities/claim-extract.entity';
import { ExtractClaimsResponseDto } from './dto/extract-claims-response.dto';

@Injectable()
export class ClaimsExtractorService {
  private readonly logger = new Logger(ClaimsExtractorService.name);
  private readonly openai: OpenAI;

  constructor(
    @InjectRepository(ClaimExtract)
    private readonly claimExtractRepository: Repository<ClaimExtract>,
    private readonly configService: ConfigService,
  ) {
    this.openai = new OpenAI({
      apiKey: this.configService.get<string>('openai.apiKey'),
    });
  }

  async extractFromDocuments(files: Express.Multer.File[]): Promise<ExtractClaimsResponseDto> {
    this.logger.log(`Processing ${files.length} files`);
    
    // 1. Obtener configuraciones dinámicas desde la base de datos
    const extractConfigs = await this.claimExtractRepository.find();
    this.logger.log(`Found ${extractConfigs.length} extraction configurations in database`);

    const result: ExtractClaimsResponseDto = {};

    // 2. Procesar cada archivo que coincida con las configuraciones
    for (const file of files) {
      const config = extractConfigs.find(c => c.filename === file.originalname);
      
      if (config) {
        this.logger.log(`Processing file: ${file.originalname} with fieldname: ${config.fieldname}`);
        
        try {
          // Extraer texto del PDF
          const pdfText = await this.extractTextFromPdf(file.buffer);
          
          // Procesar con OpenAI usando el prompt específico de la BD
          const extractedData = await this.processWithAI(pdfText, config.prompt, config.example);
          
          // Agregar al resultado usando el fieldname dinámico
          result[config.fieldname] = extractedData;
          
        } catch (error) {
          this.logger.error(`Error processing file ${file.originalname}:`, error);
          result[config.fieldname] = '';
        }
      } else {
        this.logger.warn(`No configuration found for file: ${file.originalname} - ignoring`);
      }
    }

    // 3. Llenar campos faltantes con string vacío
    for (const config of extractConfigs) {
      if (!(config.fieldname in result)) {
        result[config.fieldname] = '';
      }
    }

    return result;
  }

  private async extractTextFromPdf(buffer: Buffer): Promise<string> {
    try {
      const data = await pdfParse(buffer);
      return data.text;
    } catch (error) {
      this.logger.error('Error extracting text from PDF:', error);
      throw new Error('Failed to extract text from PDF');
    }
  }

  private async processWithAI(text: string, prompt: string, example: string): Promise<string> {
    try {
      const completion = await this.openai.chat.completions.create({
        model: this.configService.get<string>('openai.model') || 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: `You are a legal document analyzer. ${prompt}\n\nExample output format: ${example}\n\nIf the required information is not found in the document, return an empty string.`,
          },
          {
            role: 'user',
            content: `Please analyze this document text and extract the required information:\n\n${text}`,
          },
        ],
        temperature: 0.1,
        max_tokens: 1000,
      });

      const result = completion.choices[0]?.message?.content?.trim() || '';
      this.logger.log(`AI processing completed, result length: ${result.length}`);
      
      return result;
    } catch (error) {
      this.logger.error('Error processing with OpenAI:', error);
      throw new Error('Failed to process document with AI');
    }
  }
} 
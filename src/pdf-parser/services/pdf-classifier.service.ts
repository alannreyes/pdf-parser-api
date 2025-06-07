import { Injectable, Logger } from '@nestjs/common';
import * as pdf from 'pdf-parse';
import { PDFDocument } from 'pdf-lib';
import { TipoPDF, ResultadoClasificacion } from '../types/pdf-types';

@Injectable()
export class PdfClassifierService {
  private readonly logger = new Logger(PdfClassifierService.name);

  async clasificarPDF(buffer: Buffer): Promise<ResultadoClasificacion> {
    try {
      // Análisis con pdf-parse
      const dataParse = await pdf(buffer);
      
      // Análisis con pdf-lib para características avanzadas
      const pdfDoc = await PDFDocument.load(buffer, { 
        ignoreEncryption: false,
        throwOnInvalidObject: false 
      });

      const cantidadTexto = dataParse.text.trim().length;
      const tieneTexto = cantidadTexto > 0;
      const textoPorPagina = cantidadTexto / dataParse.numpages;
      
      // Determinar calidad del texto
      let calidadTexto: 'alta' | 'media' | 'baja' | 'sin_texto';
      if (!tieneTexto) {
        calidadTexto = 'sin_texto';
      } else if (textoPorPagina > 500) {
        calidadTexto = 'alta';
      } else if (textoPorPagina > 100) {
        calidadTexto = 'media';
      } else {
        calidadTexto = 'baja';
      }
      
      // Verificar si está protegido
      const estaProtegido = this.verificarProteccion(dataParse);
      
      // Verificar formularios
      let tieneFormularios = false;
      try {
        const form = pdfDoc.getForm();
        const fields = form.getFields();
        tieneFormularios = fields.length > 0;
      } catch (error) {
        // Si falla, no tiene formularios
      }

      // Determinar tipo y método de extracción
      let tipo: TipoPDF;
      let requiereOCR = false;
      let metodoExtraccion = '';

      if (estaProtegido) {
        tipo = TipoPDF.PROTEGIDO;
        metodoExtraccion = 'desencriptar_primero';
      } else if (tieneFormularios) {
        tipo = TipoPDF.FORMULARIO;
        metodoExtraccion = 'extraer_formularios';
      } else if (!tieneTexto) {
        tipo = TipoPDF.ESCANEADO;
        requiereOCR = true;
        metodoExtraccion = 'ocr_requerido';
      } else if (textoPorPagina < 100) {
        tipo = TipoPDF.MIXTO;
        requiereOCR = true;
        metodoExtraccion = 'ocr_mejorado';
      } else {
        tipo = TipoPDF.NATIVO;
        metodoExtraccion = 'extraccion_directa';
      }

      const resultado = {
        tipo,
        tieneTexto,
        cantidadTexto,
        numeroPaginas: dataParse.numpages,
        requiereOCR,
        tieneFormularios,
        estaProtegido,
        metodoExtraccion,
        calidadTexto
      };

      this.logger.log(`PDF clasificado: ${JSON.stringify(resultado)}`);

      return resultado;

    } catch (error) {
      console.error('Error clasificando PDF:', error);
      // Por defecto, asumir escaneado si hay error
      return {
        tipo: TipoPDF.ESCANEADO,
        tieneTexto: false,
        cantidadTexto: 0,
        numeroPaginas: 0,
        requiereOCR: true,
        tieneFormularios: false,
        estaProtegido: false,
        metodoExtraccion: 'ocr_requerido',
        calidadTexto: 'sin_texto'
      };
    }
  }

  private verificarProteccion(data: any): boolean {
    return data.info && (
      data.info.IsEncrypted === true ||
      data.info.IsAcroFormPresent === true ||
      data.metadata?.encrypted === true
    );
  }
}
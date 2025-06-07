export enum TipoPDF {
  NATIVO = 'PDF_NATIVO',
  ESCANEADO = 'PDF_ESCANEADO',
  MIXTO = 'PDF_MIXTO',
  FORMULARIO = 'PDF_FORMULARIO',
  PROTEGIDO = 'PDF_PROTEGIDO',
}

export interface ResultadoClasificacion {
  tipo: TipoPDF;
  tieneTexto: boolean;
  cantidadTexto: number;
  numeroPaginas: number;
  requiereOCR: boolean;
  tieneFormularios: boolean;
  estaProtegido: boolean;
  metodoExtraccion: string;
  calidadTexto: 'alta' | 'media' | 'baja' | 'sin_texto'; // Agregar esta línea
}

export interface PdfMetadata {
  titulo?: string;
  autor?: string;
  creador?: string;
  fechaCreacion?: Date;
  fechaModificacion?: Date;
}
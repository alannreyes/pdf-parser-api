export interface ExtractionStrategy {
  extract(buffer: Buffer): Promise<string>;
  canHandle(tipo: string): boolean;
}
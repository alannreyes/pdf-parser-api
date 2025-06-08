import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { json, urlencoded } from 'express';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bodyParser: false, // Desactivar el body parser por defecto
  });

  // Configurar límites de tamaño
  const maxFileSize = process.env.MAX_FILE_SIZE || '52428800';
  console.log('Configurando MAX_FILE_SIZE:', maxFileSize);
  
  // Usar express integrado para configurar límites
  app.use(json({ limit: maxFileSize }));
  app.use(urlencoded({ extended: true, limit: maxFileSize }));

  // CORS
  app.enableCors({
    origin: true,
    credentials: true,
  });

  // Global pipes
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  // Global filters
  app.useGlobalFilters(new HttpExceptionFilter());

  // Swagger documentation
  const config = new DocumentBuilder()
    .setTitle('PDF Parser API')
    .setDescription('API para extraer y convertir PDFs a markdown usando GPT-4o')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document);

  const port = process.env.PORT || 5000;
  await app.listen(port);
  console.log(`Application is running on: http://localhost:${port}`);
  console.log(`Swagger documentation: http://localhost:${port}/api`);
  console.log(`Max file size configured: ${parseInt(maxFileSize) / 1024 / 1024}MB`);
}
bootstrap();
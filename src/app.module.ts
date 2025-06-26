import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerModule } from '@nestjs/throttler';
import { ClaimsExtractorModule } from './claims-extractor/claims-extractor.module';
import configuration from './config/configuration';
import { ClaimExtract } from './entities/claim-extract.entity';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    TypeOrmModule.forRoot({
      type: 'mysql',
      host: 'automate_mysql',
      port: 3306,
      username: 'mysql',
      password: '27d9IyP3Tyg19WUL8a6T',
      database: 'axioma',
      entities: [ClaimExtract],
      synchronize: true,
      logging: true,
      retryAttempts: 5,
      retryDelay: 3000,
      autoLoadEntities: true,
    }),
    ThrottlerModule.forRoot([{
      ttl: 60000,
      limit: 10,
    }]),
    ClaimsExtractorModule,
  ],
})
export class AppModule {} 
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
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        console.log('=== TypeORM Config Debug ===');
        console.log('DB_HOST from env:', process.env.DB_HOST);
        console.log('config.get(database.host):', config.get('database.host'));
        console.log('config.get(database.url):', config.get('database.url'));
        
        return {
          type: 'mysql',
          host: config.get('database.host') || 'automate_mysql',
          port: config.get('database.port') || 3306,
          username: config.get('database.username') || 'mysql',
          password: config.get('database.password') || '27d9IyP3Tyg19WUL8a6T',
          database: config.get('database.database') || 'axioma',
          entities: [ClaimExtract],
          synchronize: true,
          logging: true,
          retryAttempts: 5,
          retryDelay: 3000,
          autoLoadEntities: true,
        };
      },
    }),
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ([{
        ttl: config.get<number>('THROTTLE_TTL', 60) * 1000,
        limit: config.get<number>('THROTTLE_LIMIT', 10),
      }]),
    }),
    ClaimsExtractorModule,
  ],
})
export class AppModule {} 
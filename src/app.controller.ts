import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('debug-config')
  getDebugConfig() {
    return {
      timestamp: new Date().toISOString(),
      environment: {
        NODE_ENV: process.env.NODE_ENV,
        PORT: process.env.PORT,
        DATABASE_URL: process.env.DATABASE_URL ? '***SET***' : 'NOT_SET',
        DB_HOST: process.env.DB_HOST,
        DB_PORT: process.env.DB_PORT,
        DB_USERNAME: process.env.DB_USERNAME,
        DB_PASSWORD: process.env.DB_PASSWORD ? '***SET***' : 'NOT_SET',
        DB_NAME: process.env.DB_NAME,
      },
      hardcoded_values: {
        host: 'automate_mysql',
        port: 3306,
        username: 'mysql',
        database: 'axioma'
      },
      message: 'Si ve undefined en environment pero hardcoded_values es correcto, problema es variables entorno'
    };
  }
}

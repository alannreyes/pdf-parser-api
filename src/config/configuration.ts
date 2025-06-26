export default () => ({
  port: parseInt(process.env.PORT || '5000', 10),
  database: {
    url: process.env.DATABASE_URL || `mysql://${process.env.DB_USERNAME || 'mysql'}:${process.env.DB_PASSWORD || '27d9IyP3Tyg19WUL8a6T'}@${process.env.DB_HOST || 'automate_mysql'}:${process.env.DB_PORT || '3306'}/${process.env.DB_NAME || 'axioma'}`,
    host: process.env.DB_HOST || 'automate_mysql',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    username: process.env.DB_USERNAME || 'mysql',
    password: process.env.DB_PASSWORD || '27d9IyP3Tyg19WUL8a6T',
    database: process.env.DB_NAME || 'axioma',
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL || 'gpt-4o',
  },
  upload: {
    maxFileSize: parseInt(process.env.MAX_FILE_SIZE || '10485760', 10),
  },
  throttle: {
    ttl: parseInt(process.env.THROTTLE_TTL || '60', 10),
    limit: parseInt(process.env.THROTTLE_LIMIT || '10', 10),
  },
});
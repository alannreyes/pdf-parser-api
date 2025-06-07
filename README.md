# PDF Parser API

API REST construida por Alann Reyes con NestJS para extraer y convertir contenido de PDFs a formato Markdown usando GPT-4o.

## 🚀 Características

- ✅ Extracción de texto de PDFs
- ✅ Conversión inteligente a Markdown usando GPT-4o
- ✅ Análisis de contenido (resumen, temas principales, puntos clave)
- ✅ Extracción de metadatos
- ✅ Soporte para PDFs desde URL
- ✅ Rate limiting integrado
- ✅ Documentación Swagger automática
- ✅ Listo para Docker y Easypanel

## 📋 Requisitos

- Node.js 18+
- OpenAI API Key

## 🛠️ Instalación

1. Clonar el repositorio:
\`\`\`bash
git clone https://github.com/tu-usuario/pdf-parser-api.git
cd pdf-parser-api
\`\`\`

2. Instalar dependencias:
\`\`\`bash
npm install
\`\`\`

3. Configurar variables de entorno:
\`\`\`bash
cp .env.example .env
# Editar .env con tu OPENAI_API_KEY
\`\`\`

4. Ejecutar en desarrollo:
\`\`\`bash
npm run start:dev
\`\`\`

## 🐳 Docker

Construir imagen:
\`\`\`bash
docker build -t pdf-parser-api .
\`\`\`

Ejecutar contenedor:
\`\`\`bash
docker run -p 3000:3000 --env-file .env pdf-parser-api
\`\`\`

## 📖 Uso de la API

### Endpoint principal
\`\`\`
POST /pdf/parse
Content-Type: multipart/form-data

Body:
- file: archivo PDF
- includeAnalysis: boolean (opcional)
- extractMetadata: boolean (opcional)
- instructions: string (opcional)
\`\`\`

### Respuesta
\`\`\`json
{
  "markdown": "# Contenido del PDF...",
  "metadata": {
    "title": "Título",
    "pageCount": 10
  },
  "analysis": {
    "summary": "Resumen del contenido",
    "mainTopics": ["tema1", "tema2"],
    "keyPoints": ["punto1", "punto2"]
  },
  "processingTime": 2500
}
\`\`\`

## 🔗 Integración con n8n

Esta API está optimizada para integrarse con n8n. Simplemente usa un nodo HTTP Request con:
- Method: POST
- URL: http://tu-api/pdf/parse
- Body: Multipart Form Data

## 📝 Documentación

Swagger UI disponible en: `http://localhost:3000/api`

## 🚀 Despliegue en Easypanel

1. Fork este repositorio
2. En Easypanel, crear nueva app desde GitHub
3. Configurar variables de entorno
4. Deploy!

## 📄 Licencia

MIT

## 👥 Contribuciones

Las contribuciones son bienvenidas! Por favor, abre un issue o pull request.

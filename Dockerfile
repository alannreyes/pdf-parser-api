FROM node:20-alpine AS builder

# Instalar dependencias para pdf-parse
RUN apk add --no-cache python3 make g++ 

WORKDIR /app

# Copiar archivos de configuración
COPY package*.json ./
COPY tsconfig*.json ./

# Instalar dependencias
RUN npm ci

# Copiar código fuente
COPY . .

# Construir aplicación
RUN npm run build

# Etapa de producción
FROM node:20-alpine

# Instalar dependencias de runtime para pdf-parse
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copiar archivos necesarios desde builder
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules

# Exponer puerto
EXPOSE 3000

# Comando de inicio
CMD ["node", "dist/main"]
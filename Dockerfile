FROM node:20-alpine

WORKDIR /app

# Copia manifesto primeiro para aproveitar cache de camadas
COPY --chown=node:node package*.json ./
RUN npm ci --omit=dev

# Copia o restante do projeto
COPY --chown=node:node . .

EXPOSE 3000

# Roda como usuário não-root
USER node

CMD ["node", "server.js"]

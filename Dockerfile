FROM node:22-alpine
WORKDIR /app

COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci

COPY . .
RUN npm run build

ENV NODE_ENV=production
EXPOSE 4003
CMD ["npm", "run", "start:migrate"]

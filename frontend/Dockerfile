# syntax=docker/dockerfile:1
ARG TARGETPLATFORM=linux/amd64
FROM --platform=${TARGETPLATFORM} node:18-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
ARG VERSION
ENV VERSION=$VERSION
RUN npm run build

ARG TARGETPLATFORM=linux/amd64
FROM --platform=${TARGETPLATFORM} nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]


FROM golang:1.24-alpine AS build
WORKDIR /app
COPY . .
RUN go mod download
ARG VERSION=1.0
ENV VERSION=${VERSION}

RUN CGO_ENABLED=0 GOOS=linux go build -o server ./cmd/server

FROM gcr.io/distroless/base-debian12:nonroot
WORKDIR /app
COPY --from=build /app/server /app/server
VOLUME ["/data"]
ENV SERVER_ADDR=:8080
EXPOSE 8080
USER nonroot:nonroot
ENTRYPOINT ["/app/server"]

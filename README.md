# Agente IA Multitenant - Chat-First con LiveKit

Agente conversacional SaaS multitenant que usa LiveKit como plataforma central para manejar sesiones, mensajería en tiempo real y audio. Orquesta múltiples LLMs (OpenAI, Gemini, Groq), RAG y herramientas dinámicas definidas por `agentConfigDB`.

## 🎯 Características Principales

- **Chat-First**: Flujo principal basado en chat con voz opcional
- **LiveKit Integration**: Sesiones, mensajería en tiempo real y audio
- **Multi-LLM**: Orquestación entre OpenAI, Gemini y Groq
- **RAG Híbrido**: Vector DB + APIs externas configurables
- **Multitenancy**: Datos y configuraciones completamente aisladas por `tenantId`
- **Control de Uso**: Límites mensuales de conversaciones por plan
- **TTS/STT**: AWS Polly para síntesis de voz, Groq Whisper para reconocimiento

## 📁 Estructura del Proyecto

```
src/
  /livekit          # LiveKit Agent Worker y clientes
  /agent            # Orquestador, LLM Router, Prompt Builder, Tool Registry
  /db               # Database Manager y repositorios
  /api              # Controllers REST API
  /middleware       # Tenant, Usage, Auth middleware
  /services         # Servicios de negocio (RAG, External API)
  /infra            # K8s, Helm, Terraform
  /tests            # Unit, Integration, E2E tests
  /docs             # Documentación técnica
  /frontend         # Widget React demo
```

## 🚀 Inicio Rápido

### Prerrequisitos

- Node.js 20+
- MongoDB (Atlas o local)
- LiveKit Server (self-hosted o cloud)
- AWS Account (para Polly)
- API Keys: OpenAI, Gemini, Groq (según configuración)

### Instalación

```bash
npm install
cp .env.example .env
# Editar .env con tus credenciales
```

### Desarrollo

```bash
# Servidor API
npm run dev

# LiveKit Agent Worker (en terminal separado)
npm run start:agent
```

### Tests

```bash
npm test
npm run test:coverage
```

## 📚 Documentación

- **API Documentation (Swagger)**: http://localhost:3500/api-docs
- [Guía de Despliegue en Plesk](./docs/plesk-deployment.md) 🚀
- [Swagger Setup Guide](./docs/swagger-setup.md)
- [Architecture](./docs/architecture.md)
- [Runbook](./docs/runbook.md)
- [Developer Guide](./docs/developer-guide.md)

## 🏗️ Roadmap

Ver [project-plan.md](./docs/project-plan.md) para el roadmap completo de 9 sprints.

## 📝 Licencia

MIT

